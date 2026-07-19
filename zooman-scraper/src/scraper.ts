import { Product, Category, ScraperConfig, ParsingSummary, ProductSpecification } from './types';
import { delay, cleanText, toAbsoluteUrl, log, saveToJson } from './helpers';
import * as path from 'path';
import puppeteer from 'puppeteer';

export class ZoomanScraper {
  private config: ScraperConfig;
  private browser: any;
  private startTime: number = 0;
  private pages: any[] = [];
  private currentPageIndex = 0;

  constructor(config: ScraperConfig) {
    this.config = config;
  }

  async run(): Promise<void> {
    this.startTime = Date.now();
    log('🚀 Запуск парсера zooman.ru (ОПТИМИЗИРОВАННАЯ ВЕРСИЯ)');
    
    this.browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
    });
    
    try {
      // Создаём пул из 5 вкладок для параллельной обработки товаров
      log('🔧 Создание пула из 5 вкладок...');
      for (let i = 0; i < 5; i++) {
        const page = await this.browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        await page.setDefaultNavigationTimeout(30000);
        
        // Блокируем загрузку тяжёлых ресурсов (картинки, шрифты, стили) для ускорения в 3-5 раз
        await page.setRequestInterception(true);
        page.on('request', (req: any) => {
          if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
            req.abort();
          } else {
            req.continue();
          }
        });
        
        this.pages.push(page);
      }
      
      const allCategories = await this.getAllCategories();
      log(`📁 Всего категорий: ${allCategories.length}`);
      
      const allProducts: Product[] = [];
      const categoryStats: { name: string; productCount: number }[] = [];
      const brandStats: { [key: string]: number } = {};
      
      for (const cat of allCategories) {
        try {
          log(`\n📂 Парсинг: ${cat.name}`);
          const products = await this.parseCategoryDeep(cat);
          
          if (products.length > 0) {
            cat.productCount = products.length;
            categoryStats.push({ name: cat.name, productCount: products.length });
            
            products.forEach(p => {
              if (p.brand) brandStats[p.brand] = (brandStats[p.brand] || 0) + 1;
            });
            
            allProducts.push(...products);
            
            const fileName = `${cat.id}.json`;
            const filePath = path.join(this.config.outputDir, 'subcategories', fileName);
            await saveToJson(products, filePath, this.config.jsonPrettyPrint);
            log(`  💾 Сохранено: ${cat.name} (${products.length} товаров)`);
          }
        } catch (error: any) {
          log(`❌ Ошибка в "${cat.name}": ${error.message}`, 'error');
        }
      }
      
      for (const page of this.pages) {
        await page.close();
      }
      
      await saveToJson(allProducts, path.join(this.config.outputDir, 'products.json'), this.config.jsonPrettyPrint);
      
      const summary = this.createSummary(allProducts, categoryStats, brandStats);
      await saveToJson(summary, path.join(this.config.outputDir, 'summary.json'), this.config.jsonPrettyPrint);
      
      const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
      log(`\n✅ Завершено за ${duration}с! Всего товаров: ${allProducts.length}`);
      
    } finally {
      await this.browser.close();
    }
  }

  private async getAllCategories(): Promise<Category[]> {
    const page = await this.browser.newPage();
    const categories: Category[] = [];
    
    try {
      log('🔍 Загрузка каталога...');
      await page.goto(`${this.config.baseUrl}/catalog/`, { waitUntil: 'networkidle2', timeout: 30000 });
      await delay(2000);
      
      const categoriesData = await page.evaluate(() => {
        const cats: any[] = [];
        document.querySelectorAll('li.sect a.dark_link').forEach((a: any) => {
          const href = a.getAttribute('href') || '';
          const text = a.textContent?.trim() || '';
          const cleanName = text.replace(/\s*\d+$/, '').trim();
          
          if (href && cleanName.length > 2) {
            cats.push({
              name: cleanName,
              url: href.startsWith('http') ? href : `https://zooman.ru${href}`
            });
          }
        });
        return cats;
      });
      
      const seenUrls = new Set<string>();
      categoriesData.forEach((cat: any, idx: number) => {
        if (!seenUrls.has(cat.url)) {
          seenUrls.add(cat.url);
          categories.push({
            id: `cat_${idx}_${cat.name.replace(/\s+/g, '_').toLowerCase().replace(/[^a-zа-я0-9_]/g, '')}`,
            name: cat.name,
            url: cat.url,
            level: 1,
            hasChildren: false,
            childrenCount: 0,
            parentSection: 'main'
          });
        }
      });
      
      log(`✅ Обработано уникальных подкатегорий: ${categories.length}`);
    } catch (error: any) {
      log(`❌ Ошибка загрузки категорий: ${error.message}`, 'error');
    } finally {
      await page.close();
    }
    
    return categories;
  }

  private getNextPage(): any {
    const page = this.pages[this.currentPageIndex];
    this.currentPageIndex = (this.currentPageIndex + 1) % this.pages.length;
    return page;
  }

  private async parseCategoryDeep(category: Category): Promise<Product[]> {
    const products: Product[] = [];
    const seenUrls = new Set<string>();
    let currentPage = 1;
    let hasMorePages = true;

    while (hasMorePages) {
      const separator = category.url.includes('?') ? '&' : '?';
      const pageUrl = currentPage === 1 ? category.url : `${category.url}${separator}PAGEN_1=${currentPage}`;
      log(`  🌐 Страница: ${currentPage}`);
      
      try {
        const page = this.getNextPage();
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await delay(500);

        const paginationInfo = await page.evaluate((current: number) => {
          const allLinks = document.querySelectorAll('a[href]');
          let hasNextPage = false;
          let totalPages = current;
          
          for (const link of Array.from(allLinks)) {
            const href = link.getAttribute('href') || '';
            const match = href.match(/PAGEN_1=(\d+)/);
            if (match) {
              const pageNum = parseInt(match[1]);
              if (pageNum > totalPages) totalPages = pageNum;
              if (pageNum === current + 1) hasNextPage = true;
            }
          }
          return { hasNextPage, totalPages };
        }, currentPage);

        log(`  📊 Пагинация: есть следующая = ${paginationInfo.hasNextPage}, всего страниц = ${paginationInfo.totalPages}`);

        // 🔑 КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ: ищем ссылки только в основных карточках (.list_item_wrapp), 
        // игнорируя блоки "Рекомендуем" и слайдеры (.catalog_item)
        const productLinks = await page.evaluate(() => {
          const links: string[] = [];
          document.querySelectorAll('.list_item_wrapp a[href*="/catalog/products/"], .list_item a[href*="/catalog/products/"]').forEach((a: any) => {
            const href = a.getAttribute('href');
            if (href && !links.includes(href)) {
              links.push(href);
            }
          });
          return links;
        });

        if (productLinks.length === 0) {
          log(`  ⚠️ Товары не найдены на странице ${currentPage}`);
          hasMorePages = false;
          break;
        }

        log(`  🔗 Найдено товаров на странице: ${productLinks.length}`);

        // ПАРАЛЛЕЛЬНАЯ ОБРАБОТКА ТОВАРОВ (по 10 одновременно)
        const batchSize = 10;
        for (let i = 0; i < productLinks.length; i += batchSize) {
          const batch = productLinks.slice(i, i + batchSize);
          
          const batchPromises = batch.map(async (link: string) => {
            const productUrl = toAbsoluteUrl(this.config.baseUrl, link);
            
            if (seenUrls.has(productUrl)) return null;
            seenUrls.add(productUrl);
            
            try {
              const page = this.getNextPage();
              const productData = await this.parseProductDetails(page, productUrl, category);
              return productData;
            } catch (err: any) {
              return null;
            }
          });
          
          const results = await Promise.all(batchPromises);
          const validProducts = results.filter(p => p !== null);
          products.push(...validProducts);
          
          log(`  📦 Обработано ${Math.min(i + batchSize, productLinks.length)}/${productLinks.length} товаров (всего в категории: ${products.length})`);
        }

        if (!paginationInfo.hasNextPage) {
          log(`  🏁 Последняя страница: ${currentPage}`);
          hasMorePages = false;
        } else {
          log(`  ➡️ Переход на страницу ${currentPage + 1}`);
          currentPage++;
        }

      } catch (error: any) {
        log(`  ❌ Ошибка страницы ${currentPage}: ${error.message}`, 'error');
        hasMorePages = false;
      }
    }

    return products;
  }

  private async parseProductDetails(page: any, url: string, category: Category): Promise<Product | null> {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await delay(100);

      const data = await page.evaluate(() => {
        const nameEl = document.querySelector('h1, [itemprop="name"]');
        const name = nameEl?.textContent?.trim() || '';
        if (!name || name.length < 3) return null;

        const brandEl = document.querySelector('.catalog-element-props a[href*="/brands/"]');
        const brand = brandEl?.textContent?.trim() || '';

        const priceEl = document.querySelector('.cost.prices .price_value');
        const priceText = priceEl?.textContent?.trim() || '0';
        const price = parseInt(priceText.replace(/\D/g, ''), 10) || 0;

        const propsEl = document.querySelector('.catalog-element-props');
        const propsText = propsEl ? propsEl.textContent.replace(/\s+/g, ' ') : '';
        
        const articleMatch = propsText.match(/Артикул:\s*([^\n\r<]+)/i);
        const article = articleMatch ? articleMatch[1].trim() : '';

        const barcodeMatch = propsText.match(/Штрих-код:\s*([^\n\r<]+)/i);
        const barcode = barcodeMatch ? barcodeMatch[1].trim() : '';

        const countryMatch = propsText.match(/Страна:\s*([^\n\r<]+)/i);
        const country = countryMatch ? countryMatch[1].trim() : '';

        const imgs: { url: string; alt: string; position: number }[] = [];
        document.querySelectorAll('.section-gallery-wrapper__item img').forEach((img: any, idx: number) => {
          const src = img.getAttribute('data-src') || img.getAttribute('src');
          if (src && !src.includes('data:image') && !src.includes('base64')) {
            const cleanSrc = src.replace('/resize_cache/', '/').replace(/\/\d+_\d+_\w+\//, '/');
            imgs.push({
              url: cleanSrc.startsWith('http') ? cleanSrc : `https://zooman.ru${cleanSrc}`,
              alt: img.getAttribute('alt') || name,
              position: idx
            });
          }
        });

        let totalStock = 0;
        let inStock = false;
        document.querySelectorAll('.item-stock .value span').forEach((span: any) => {
          const match = span.textContent.match(/\((\d+)\)/);
          if (match) {
            const count = parseInt(match[1], 10);
            totalStock += count;
            if (count > 0) inStock = true;
          }
        });

        const specs: ProductSpecification[] = [];
        document.querySelectorAll('table.props_list tr, .characteristics tr').forEach((tr: any) => {
          const tds = tr.querySelectorAll('td');
          if (tds.length >= 2) {
            const n = tds[0].textContent?.trim() || '';
            const v = tds[1].textContent?.trim() || '';
            if (n && v) specs.push({ name: n, value: v });
          }
        });

        const descEl = document.querySelector('.element_detail_text .text, .description_text, [itemprop="description"]');
        const description = descEl?.textContent?.trim() || '';

        let weight = '';
        const weightSpec = specs.find(s => s.name.toLowerCase().includes('вес'));
        if (weightSpec) {
          const m = weightSpec.value.match(/([\d.,]+)/);
          if (m) weight = `${m[1]} кг`;
        } else {
          const nameWeightMatch = name.match(/(\d+)\s*(г|кг)/i);
          if (nameWeightMatch) weight = nameWeightMatch[0];
        }

        const tags: string[] = [];
        if (document.querySelector('.sticker_khit, .sticker_hit')) tags.push('ХИТ');
        if (document.querySelector('.sticker_new, .sticker_novinka')) tags.push('НОВИНКА');
        if (document.querySelector('.sticker_sale, .sticker_action')) tags.push('АКЦИЯ');

        return {
          name, brand, price, 
          images: imgs,
          specifications: specs,
          description,
          inStock,
          stockQuantity: totalStock.toString(),
          article, barcode, country, weight,
          tags
        };
      });

      if (!data || !data.name || data.name.length < 3) {
        return null;
      }

      const mainImage = data.images.length > 0 ? data.images[0].url : '';
      const slug = url.split('/').filter(Boolean).pop() || '';

      return {
        id: data.article || slug,
        article: data.article,
        name: data.name,
        slug,
        url,
        category,
        brand: data.brand || undefined,
        description: data.description,
        shortDescription: data.description ? data.description.substring(0, 200) + '...' : undefined,
        images: data.images,
        mainImage,
        price: data.price || undefined,
        oldPrice: undefined,
        currency: data.price ? 'RUB' : undefined,
        barcode: data.barcode || undefined,
        inStock: data.inStock,
        stockQuantity: data.stockQuantity,
        specifications: data.specifications,
        tags: data.tags,
        isNew: data.tags.includes('НОВИНКА'),
        isSale: data.tags.includes('АКЦИЯ'),
        isHit: data.tags.includes('ХИТ'),
        weight: data.weight || undefined,
        country: data.country || undefined,
        parsedAt: new Date().toISOString(),
        sourceUrl: url,
      };

    } catch (error: any) {
      return null;
    }
  }

  private createSummary(
    products: Product[], 
    categoryStats: { name: string; productCount: number }[], 
    brandStats: { [key: string]: number }
  ): ParsingSummary {
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
    const tags: { name: string; count: number }[] = [];
    const brands = Object.entries(brandStats)
      .map(([name, count]) => ({ name, count: count as number }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);
    
    return {
      totalProducts: products.length,
      totalCategories: categoryStats.length,
      parsedAt: new Date().toISOString(),
      duration: `${duration}s`,
      categories: categoryStats,
      tags,
      brands,
    };
  }
}