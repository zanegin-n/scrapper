import * as cheerio from 'cheerio';
import { AxiosInstance } from 'axios';
import { Product, Category, ScraperConfig, ParsingSummary } from './types';
import { 
  createHttpClient, 
  delay, 
  cleanText, 
  toAbsoluteUrl, 
  log, 
  saveToJson
} from './helpers';
import * as path from 'path';
import puppeteer from 'puppeteer';

type CheerioType = ReturnType<typeof cheerio.load>;

export class AquanimalScraper {
  private config: ScraperConfig;
  private httpClient: AxiosInstance;
  private visitedUrls: Set<string> = new Set();
  private startTime: number = 0;

  constructor(config: ScraperConfig) {
    this.config = config;
    this.httpClient = createHttpClient(config.baseUrl, config.maxRetries);
  }

  async run(): Promise<void> {
    this.startTime = Date.now();;
    
    const categories = await this.getAllCategories();
    log(`Найдено категорий: ${categories.length}`);
    
    const allProducts: Product[] = [];
    const categoryStats: { name: string; productCount: number }[] = [];
    
    for (const category of categories) {
      log(` Парсинг категории: ${category.name}`);
      const products = await this.parseCategory(category);
      
      category.productCount = products.length;
      categoryStats.push({
        name: category.name,
        productCount: products.length
      });
      
      allProducts.push(...products);
      
      if (this.config.splitByCategory) {
        await saveToJson(
          products,
          path.join(this.config.outputDir, 'products-by-category', `${category.id}.json`),
          this.config.jsonPrettyPrint
        );
      }
      
      await delay(this.config.delayBetweenRequests);
    }
    
    await saveToJson(
      allProducts,
      path.join(this.config.outputDir, 'products.json'),
      this.config.jsonPrettyPrint
    );
    
    const summary = this.createSummary(allProducts, categories, categoryStats);
    await saveToJson(
      summary,
      path.join(this.config.outputDir, 'summary.json'),
      this.config.jsonPrettyPrint
    );
    
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
    log(`Парсинг завершен за ${duration}с! Товаров: ${allProducts.length}`);
  }

  async getAllCategories(): Promise<Category[]> {
    try {
      const response = await this.httpClient.get('/');
      const $ = cheerio.load(response.data);
      const categories: Category[] = [];
      
      $('nav a, .menu a, .catalog-menu a').each((_, element) => {
        const href = $(element).attr('href');
        const name = cleanText($(element).text());
        
        if (href && href.includes('/catalog/') && name && name.length > 0) {
          const id = href.split('/').filter(Boolean).pop() || '';
          categories.push({
            id,
            name,
            url: toAbsoluteUrl(this.config.baseUrl, href),
          });
        }
      });
      
      if (categories.length === 0) {
        categories.push(
          { id: 'akvariumistika', name: 'Аквариумистика', url: `${this.config.baseUrl}/catalog/akvariumistika/` },
          { id: 'dlya_koshek_i_sobak', name: 'Для кошек и собак', url: `${this.config.baseUrl}/catalog/dlya_koshek_i_sobak/` },
          { id: 'dlya_gryzunov_i_ptits', name: 'Для грызунов и птиц', url: `${this.config.baseUrl}/catalog/dlya_gryzunov_i_ptits/` }
        );
      }
      
      return categories;
    } catch (error) {
      log(`Ошибка получения категорий: ${error}`, 'error');
      return [];
    }
  }

  async parseCategory(category: Category): Promise<Product[]> {
    const products: Product[] = [];
    
    try {
      const response = await this.httpClient.get(category.url);
      const $ = cheerio.load(response.data);
      
      const productLinks: string[] = [];
      
      $('a').each((_, element) => {
        const text = cleanText($(element).text());
        const href = $(element).attr('href');
        
        if (text.includes('Подробнее') && href && href.includes('/catalog/')) {
          const absoluteUrl = toAbsoluteUrl(this.config.baseUrl, href);
          if (!productLinks.includes(absoluteUrl)) {
            productLinks.push(absoluteUrl);
          }
        }
      });
      
      log(` Найдено товаров в категории: ${productLinks.length}`);
      
      for (const productUrl of productLinks) {
        if (this.visitedUrls.has(productUrl)) continue;
        
        const product = await this.parseProduct(productUrl, category);
        if (product) {
          products.push(product);
          this.visitedUrls.add(productUrl);
        }
        
        await delay(this.config.delayBetweenRequests);
      }
    } catch (error) {
      log(`Ошибка парсинга категории ${category.name}: ${error}`, 'error');
    }
    
    return products;
  }

  async parseProduct(url: string, category?: Category): Promise<Product | null> {
    try {
      const response = await this.httpClient.get(url);
      const $ = cheerio.load(response.data);
      
      const name = cleanText($('h1').first().text()) || 'Без названия';
      const bodyText = $('body').text();
      
      const skuMatch = bodyText.match(/Артикул:\s*(\d+)/);
      const sku = skuMatch ? skuMatch[1] : '';
      
      const brand = this.extractBrand($);
      
      const barcodeMatch = bodyText.match(/Штрихкод:\s*(\d+)/);
      const barcode = barcodeMatch ? barcodeMatch[1] : undefined;
      
      const packageMatch = bodyText.match(/В упаковке:\s*(\d+)/);
      const inPackage = packageMatch ? packageMatch[1] : undefined;

      const price = await this.extractPrice(url, $);
      
      const images = this.extractImages($);
      const description = this.extractDescription($);
      const specifications = this.extractSpecifications($);
      const tags = this.extractTags($);
      
      const urlParts = url.split('/').filter(Boolean);
      const slug = urlParts[urlParts.length - 1] || '';
      
      const product: Product = {
        id: sku || `product_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        sku,
        name,
        slug,
        url,
        category,
        brand,
        description,
        images,
        mainImage: images.length > 0 ? images[0].url : undefined,
        price,
        currency: price ? 'RUB' : undefined,
        specifications,
        tags,
        isNew: tags.includes('Новинка'),
        isHit: tags.includes('Хит'),
        isSale: tags.includes('Акция'),
        parsedAt: new Date().toISOString(),
        sourceUrl: url,
      };
      
      if (barcode) {
        specifications.push({ name: 'Штрихкод', value: barcode });
      }
      if (inPackage) {
        specifications.push({ name: 'В упаковке', value: inPackage });
      }
      
      log(`Товар: ${name} (Артикул: ${sku || 'N/A'}, Бренд: ${brand || 'N/A'}, Цена: ${price || 'скрыта'})`);
      return product;
    } catch (error) {
      log(`Ошибка парсинга товара ${url}: ${error}`, 'error');
      return null;
    }
  }

  private extractBrand($: CheerioType): string | undefined {
    const bodyText = $('body').text();
    const match = bodyText.match(/Бренд:\s*([A-ZА-ЯЁa-zа-яё0-9]+)/);
    return match ? match[1].trim() : undefined;
  }

  private extractImages($: CheerioType): any[] {
    const images: any[] = [];
    
    const imageSelectors = [
      '.product-gallery img',
      '.gallery img',
      '.product-images img',
      '[class*="gallery"] img',
      '[class*="product-image"] img',
      '.catalog-detail img',
      'img[src*="upload"]'
    ];
    
    imageSelectors.forEach(selector => {
      $(selector).each((index, element) => {
        const src = $(element).attr('src') || $(element).attr('data-src');
        const alt = $(element).attr('alt');
        
        if (src && !images.some(img => img.url === src)) {
          images.push({
            url: toAbsoluteUrl(this.config.baseUrl, src),
            alt: alt || '',
            position: images.length,
          });
        }
      });
    });
    
    return images;
  }

  private extractDescription($: CheerioType): string | undefined {
    $('script[type="application/ld+json"]').remove();
    $('script[type="application/json"]').remove();
    $('nav, .breadcrumb, .header, .footer, .sidebar').remove();
    
    const selectors = [
      '[itemprop="description"]',
      '.product-description',
      '.item-description',
      '.detail-text',
      '.product-detail-text',
      '.tabs .tab-content.active .description',
      '#tab-description',
      '#tab-desc',
      '.product-tabs .description',
      '.product-info .text',
      '.item-info .text',
      '.product-content .description',
      '.catalog-item-detail .text',
      '.product-detail > div',
      '.item-detail > div'
    ];
    
    for (const selector of selectors) {
      const elements = $(selector);
      
      for (let i = 0; i < elements.length; i++) {
        const element = elements.eq(i);
        const clone = element.clone();
        
        clone.find('script, style, table, .characteristics, .props, .badge, .tags, nav, .price, .buttons').remove();
        
        const text = cleanText(clone.text());
        
        if (
          text && 
          text.length > 80 && 
          text.length < 15000 &&
          !text.startsWith('{') &&
          !text.includes('BreadcrumbList') &&
          !text.includes('itemListElement') &&
          !text.includes('Артикул:') &&
          !text.includes('Штрихкод:') &&
          (text.includes(' ') || text.includes('.'))
        ) {
          console.log(`Описание найдено в ${selector} (${text.length} символов)`);
          return text;
        }
      }
    }
    
    const metaDesc = $('meta[name="description"]').attr('content');
    if (metaDesc && metaDesc.length > 50) {
      console.log(`Описание найдено в meta description`);
      return metaDesc;
    }
    
    console.log('Описание не найдено');
    return undefined;
  }

  private extractSpecifications($: CheerioType): any[] {
    const specs: any[] = [];
    const seenSpecs = new Set<string>();
    
    const tableSelectors = [
      'table.props-list',
      'table.characteristics',
      'table.product-characteristics',
      '.characteristics table',
      '.props table',
      'table[class*="props"]',
      'table[class*="characteristics"]',
      'table[class*="spec"]',
      '.product-detail table',
      'table'
    ];
    
    for (const selector of tableSelectors) {
      $(selector).each((_, table) => {
        $(table).find('tr').each((_, row) => {
          const cells = $(row).find('td, th');
          
          if (cells.length >= 2) {
            const name = cleanText(cells.first().text()).replace(/:$/, '');
            const value = cleanText(cells.last().text());
            
            if (
              name && 
              value && 
              name !== value && 
              !seenSpecs.has(name) &&
              !name.startsWith('"') &&
              name.length < 100 &&
              value.length < 200 &&
              name !== 'Артикул' &&
              name !== 'Бренд'
            ) {
              specs.push({ name, value });
              seenSpecs.add(name);
            }
          }
        });
      });
      
      if (specs.length > 3) break;
    }
    
    const listSelectors = [
      '.characteristics-list li',
      '.props-list li',
      '.product-characteristics li',
      '.characteristics .item',
      '.props .item',
      '[class*="characteristics"] li',
      '[class*="props"] li',
      '.product-detail ul li',
      '.item-detail ul li'
    ];
    
    for (const selector of listSelectors) {
      $(selector).each((_, item) => {
        const text = cleanText($(item).text());
        const match = text.match(/([^:]+):\s*(.+)/);
        
        if (match) {
          const name = cleanText(match[1]).replace(/:$/, '');
          const value = cleanText(match[2]);
          
          if (
            name && 
            value && 
            name !== value && 
            !seenSpecs.has(name) &&
            !name.startsWith('"') &&
            name.length < 100 &&
            value.length < 200 &&
            name !== 'Артикул' &&
            name !== 'Бренд'
          ) {
            specs.push({ name, value });
            seenSpecs.add(name);
          }
        }
      });
      
      if (specs.length > 3) break;
    }
    
    const blockSelectors = [
      '.product-characteristics',
      '.characteristics',
      '.props',
      '.product-props',
      '.detail-characteristics',
      '[class*="characteristics"]:not(table)',
      '[class*="props"]:not(table)',
      '.product-detail .properties',
      '.item-detail .properties'
    ];
    
    for (const selector of blockSelectors) {
      const blocks = $(selector);
      
      blocks.each((_, block) => {
        const text = $(block).text();
        const lines = text.split('\n');
        
        for (const line of lines) {
          const match = line.match(/([^:\n]+):\s*([^\n]+)/);
          if (match) {
            const name = cleanText(match[1]);
            const value = cleanText(match[2]);
            
            if (
              name && 
              value && 
              name.length < 100 && 
              value.length < 200 &&
              !name.startsWith('"') &&
              !value.startsWith('"') &&
              !name.includes('{') &&
              !value.includes('{') &&
              !seenSpecs.has(name) &&
              name !== 'Артикул' && 
              name !== 'Бренд' && 
              name !== 'Штрихкод' &&
              name !== 'В упаковке'
            ) {
              specs.push({ name, value });
              seenSpecs.add(name);
            }
          }
        }
      });
      
      if (specs.length > 5) break;
    }
    
    console.log(` Найдено характеристик: ${specs.length}`);
    return specs;
  }

  private async extractPrice(url: string, $: CheerioType): Promise<number | undefined> {
    // 1. Сначала пробуем быстрый способ (axios)
    const fastPrice = this.extractPriceFromHtml($);
    
    if (fastPrice) {
      console.log(` Цена найдена через axios: ${fastPrice}`);
      return fastPrice;
    }
    
    console.log(' Цена не найдена через axios, запускаем Puppeteer...');
    
    const browser = await puppeteer.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    try {
      await page.goto(url, { 
        waitUntil: 'networkidle2', 
        timeout: 30000 
      });
      
      await page.waitForSelector('.price, [class*="price"], [data-price]', { 
        timeout: 5000 
      }).catch(() => {});

      const price = await page.evaluate(() => {
        const selectors = [
          '.price',
          '.product-price',
          '.item-price',
          '.price-current',
          '.price-value',
          '.price__value',
          '[data-price]',
          '.product-item-price-current',
          '.catalog-item-price',
          '.price-box',
          '[class*="price"]'
        ];
        
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el) {
            const text = el.textContent || '';
            const match = text.match(/[\d\s.,]+/);
            if (match) {
              const cleaned = match[0].replace(/\s/g, '').replace(',', '.');
              const num = parseFloat(cleaned);
              if (!isNaN(num) && num > 50) {
                return num;
              }
            }
          }
        }
        
        const bodyText = document.body.innerText;
        const match = bodyText.match(/(?:цена|price|руб|₽)[^0-9]*([\d\s.,]+)/i);
        if (match) {
          const cleaned = match[1].replace(/\s/g, '').replace(',', '.');
          const num = parseFloat(cleaned);
          if (!isNaN(num) && num > 50) {
            return num;
          }
        }
        
        return null;
      });
      
    } catch (error) {
      console.log(``);
    } finally {
      await browser.close();
    }
    
    return undefined;
  }

  private extractPriceFromHtml($: CheerioType): number | undefined {
    let price: number | undefined;

    const scripts = $('script[type="application/ld+json"]');
    for (let i = 0; i < scripts.length; i++) {
      try {
        const raw = $(scripts[i]).html()?.trim() || '{}';
        const json = JSON.parse(raw);
        const found = this.findPriceInJsonLd(json);
        if (found !== undefined) {
          price = found;
          break;
        }
      } catch (e) {
      }
    }
    
    if (!price) {
      const priceSelectors = [
        '.price', '.product-price', '.item-price', '.price-current',
        '.price-value', '.price__value', '[data-price]', '.product-item-price-current',
        '.catalog-item-price', '.price-box'
      ];
      for (const sel of priceSelectors) {
        const el = $(sel).first();
        if (el.length) {
          const p = this.parsePriceFromText(el.text());
          if (p) {
            price = p;
            break;
          }
        }
      }
    }

    if (!price) {
      const bodyText = $('body').text();
      const match = bodyText.match(/(?:цена|price|руб|₽)[^0-9]*([\d\s.,]+)/i);
      if (match) {
        price = this.parsePriceFromText(match[1]);
      }
    }
    
    return price;
  }

  private findPriceInJsonLd(json: any): number | undefined {
    if (!json || typeof json !== 'object') return undefined;

    if (json.price !== undefined) {
      const p = this.parsePriceFromText(String(json.price));
      if (p) return p;
    }

    if (json.offers) {
      if (Array.isArray(json.offers)) {
        for (const o of json.offers) {
          const p = this.parsePriceFromText(String(o.price));
          if (p) return p;
        }
      } else if (json.offers.price !== undefined) {
        const p = this.parsePriceFromText(String(json.offers.price));
        if (p) return p;
      }
    }

    if (Array.isArray(json['@graph'])) {
      for (const item of json['@graph']) {
        const p = this.findPriceInJsonLd(item);
        if (p) return p;
      }
    }

    for (const key of Object.keys(json)) {
      if (typeof json[key] === 'object' && json[key] !== null) {
        const p = this.findPriceInJsonLd(json[key]);
        if (p) return p;
      }
    }

    return undefined;
  }

  private parsePriceFromText(text: string): number | undefined {
    if (!text) return undefined;
    const cleaned = text.replace(/[^\d.,]/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    return isNaN(num) || num <= 0 ? undefined : num;
  }

  private extractTags($: CheerioType): string[] {
    const tags: string[] = [];
    
    const tagSelectors = [
      '.badge',
      '.label',
      '.tag',
      '.mark',
      '[class*="badge"]',
      '[class*="label"]',
      '[class*="tag"]'
    ];
    
    tagSelectors.forEach(selector => {
      $(selector).each((_, element) => {
        const text = cleanText($(element).text());
        if (text && (text === 'Хит' || text === 'Новинка' || text === 'Акция')) {
          if (!tags.includes(text)) {
            tags.push(text);
          }
        }
      });
    });
    
    return tags;
  }

  private createSummary(
    products: Product[], 
    categories: Category[], 
    categoryStats: { name: string; productCount: number }[]
  ): ParsingSummary {
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
    
    const tagCounts: { [key: string]: number } = {};
    products.forEach(product => {
      product.tags.forEach(tag => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    });
    
    const tags = Object.entries(tagCounts).map(([name, count]) => ({ name, count }));
    
    return {
      totalProducts: products.length,
      totalCategories: categories.length,
      parsedAt: new Date().toISOString(),
      duration: `${duration}s`,
      categories: categoryStats,
      tags,
    };
  }
}