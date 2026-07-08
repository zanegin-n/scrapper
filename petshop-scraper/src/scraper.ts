import axios from 'axios';
import { Product, Category, ScraperConfig, ParsingSummary } from './types';
import { 
  delay, 
  cleanText, 
  toAbsoluteUrl, 
  log, 
  saveToJson
} from './helpers';
import * as path from 'path';
import puppeteer from 'puppeteer';

const MAIN_SECTIONS = [
  { id: 'cats',      name: 'Кошки',    url: '/catalog/cats/' },
  { id: 'dogs',      name: 'Собаки',   url: '/catalog/dogs/' },
  { id: 'rodents',   name: 'Грызуны',  url: '/catalog/rodents/' },
  { id: 'fish',      name: 'Рыбки',    url: '/catalog/fish/' },
  { id: 'birds',     name: 'Птицы',    url: '/catalog/birds/' },
];

export class PetshopScraper {
  private config: ScraperConfig;
  private browser: any;
  private startTime: number = 0;
  private cityId: number = 22;
  private apiClient: any;

  constructor(config: ScraperConfig) {
    this.config = config;

    this.apiClient = axios.create({
      baseURL: 'https://www.petshop.ru',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://www.petshop.ru/',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
  }

  async run(): Promise<void> {
    this.startTime = Date.now();
    log(' Запуск парсера petshop.ru (через axios API)');
    
    this.browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    try {
      const allCategories = await this.getAllCategories();
      log(` Всего категорий: ${allCategories.length}`);
      
      const leafCategories = allCategories.filter(cat => !cat.hasChildren);
      log(` Листовых категорий: ${leafCategories.length}`);

      this.cityId = await this.getCityId();
      log(` City ID: ${this.cityId}`);
      
      const testResult = await this.testApi();
      if (!testResult) {
        log(` API недоступен!`, 'error');
        return;
      }
      log(` API работает!`);
      
      const allProducts: Product[] = [];
      const categoryStats: { name: string; productCount: number }[] = [];
      const brandStats: { [key: string]: number } = {};
      
      for (const section of MAIN_SECTIONS) {
        log(`\n === РАЗДЕЛ: ${section.name} ===`);
        
        const sectionCats = leafCategories.filter(cat => 
          cat.parentSection === section.id
        );
        
        log(`    Листовых категорий: ${sectionCats.length}`);
        
        if (sectionCats.length === 0) continue;
        
        const sectionProducts: Product[] = [];
        
        for (const cat of sectionCats) {
          try {
            const products = await this.parseCategoryViaAxios(cat);
            
            if (products.length > 0) {
              cat.productCount = products.length;
              categoryStats.push({
                name: `${section.name} > ${cat.name}`,
                productCount: products.length
              });
              
              products.forEach(p => {
                if (p.brand) {
                  brandStats[p.brand] = (brandStats[p.brand] || 0) + 1;
                }
              });
              
              sectionProducts.push(...products);
              allProducts.push(...products);
              
              const fileName = `${section.id}-${cat.id}.json`;
              const filePath = path.join(this.config.outputDir, 'subcategories', fileName);
              await saveToJson(products, filePath, this.config.jsonPrettyPrint);
            }
          } catch (error: any) {
            log(`        Ошибка в "${cat.name}": ${error.message}`, 'error');
          }
        }
        
        if (sectionProducts.length > 0) {
          const fileName = `${section.id}.json`;
          const filePath = path.join(this.config.outputDir, fileName);
          await saveToJson(sectionProducts, filePath, this.config.jsonPrettyPrint);
          log(`   Сохранено: ${fileName} (${sectionProducts.length} товаров)`);
        }
        
        await delay(100);
      }
      
      await saveToJson(
        allProducts,
        path.join(this.config.outputDir, 'products.json'),
        this.config.jsonPrettyPrint
      );
      
      const summary = this.createSummary(allProducts, categoryStats, brandStats);
      await saveToJson(
        summary,
        path.join(this.config.outputDir, 'summary.json'),
        this.config.jsonPrettyPrint
      );
      
      const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
      log(`\n Завершено за ${duration}с! Всего товаров: ${allProducts.length}`);
      
    } finally {
      await this.browser.close();
    }
  }

  private async testApi(): Promise<boolean> {
    try {
      const response = await this.apiClient.get('/api/v4/site/catalog/products/', {
        params: {
          categoryId: 930,  
          cityId: this.cityId,
          page: 1,
          limit: 1
        }
      });
      
      log(`    Статус: ${response.status}, товаров: ${response.data?.products?.length || 0}`);
      return response.status === 200 && response.data?.products?.length > 0;
    } catch (error: any) {
      log(`    Ошибка: ${error.message}`, 'error');
      return false;
    }
  }

  private async getCityId(): Promise<number> {
    const page = await this.browser.newPage();
    try {
      await page.goto('https://www.petshop.ru/', { 
        waitUntil: 'domcontentloaded',
        timeout: 20000 
      });
      
      const cityId = await page.evaluate(() => {
        const cityCookie = document.cookie.split(';').find(c => c.trim().startsWith('cityId='));
        if (cityCookie) {
          return parseInt(cityCookie.split('=')[1]);
        }
        return 22; 
      });
      
      return cityId || 22;
    } finally {
      await page.close();
    }
  }

  private async getAllCategories(): Promise<Category[]> {
    const page = await this.browser.newPage();
    const categories: Category[] = [];
    const seenUrls = new Set<string>();
    
    try {
      await page.goto('https://www.petshop.ru/catalog/cats/food/dry_food/', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      await page.waitForFunction('window.__PS_PAGE_STORE__ !== undefined', { timeout: 15000 });
      await delay(1000);
      
      const allCats = await page.evaluate(() => {
        const store = (window as any).__PS_PAGE_STORE__;
        const cats: any[] = [];
        
        if (store?.dehydratedState?.queries) {
          for (const query of store.dehydratedState.queries) {
            const data = query?.state?.data;
            if (data?.categories && Array.isArray(data.categories)) {
              const extractCats = (categories: any[]) => {
                for (const cat of categories) {
                  if (cat.slug && cat.id) {
                    const hasChildren = cat.children && Array.isArray(cat.children) && cat.children.length > 0;
                    
                    cats.push({
                      id: cat.id,
                      numericId: cat.id,
                      name: cat.title || cat.name,
                      slug: cat.slug,
                      url: `/catalog/${cat.slug}/`,
                      level: (cat.slug.match(/\//g) || []).length,
                      hasChildren: hasChildren,
                      childrenCount: hasChildren ? cat.children.length : 0
                    });
                    
                    if (hasChildren) {
                      extractCats(cat.children);
                    }
                  }
                }
              };
              
              extractCats(data.categories);
            }
          }
        }
        
        return cats;
      });
      
      allCats.forEach((cat: any) => {
        const absoluteUrl = toAbsoluteUrl('https://www.petshop.ru', cat.url);
        
        if (!seenUrls.has(absoluteUrl)) {
          seenUrls.add(absoluteUrl);
          
          let parentSection = 'other';
          const urlParts = cat.url.split('/').filter(Boolean);
          
          if (urlParts.length > 0) {
            const firstSegment = urlParts[0];
            
            if (firstSegment === 'cats' || cat.url.includes('/cats/')) {
              parentSection = 'cats';
            } else if (firstSegment === 'dogs' || cat.url.includes('/dogs/')) {
              parentSection = 'dogs';
            } else if (firstSegment === 'rodents' || cat.url.includes('/rodents/')) {
              parentSection = 'rodents';
            } else if (firstSegment === 'fish' || cat.url.includes('/fish/')) {
              parentSection = 'fish';
            } else if (firstSegment === 'birds' || cat.url.includes('/birds/')) {
              parentSection = 'birds';
            }
          }
          
          categories.push({
            id: cat.numericId.toString(),
            name: cat.name,
            url: absoluteUrl,
            parentSection,
            level: cat.level,
            hasChildren: cat.hasChildren,
            childrenCount: cat.childrenCount,
            numericId: cat.numericId
          } as any);
        }
      });
      
      categories.sort((a, b) => (a.level || 0) - (b.level || 0));
      
      log(`   Всего категорий: ${categories.length}`);
      log(`     - Родительских: ${categories.filter(c => c.hasChildren).length}`);
      log(`     - Листовых: ${categories.filter(c => !c.hasChildren).length}`);
      
    } finally {
      await page.close();
    }
    
    return categories;
  }

  private async parseCategoryViaAxios(category: Category): Promise<Product[]> {
    const products: Product[] = [];
    let pageNum = 1;
    let hasMorePages = true;
    const seenIds = new Set<number>();
    
    const categoryId = (category as any).numericId || parseInt(category.id);
    
    if (!categoryId || isNaN(categoryId)) {
      log(`        Нет числового ID для "${category.name}"`, 'error');
      return [];
    }
    
    log(`    ${category.name} (ID: ${categoryId})`);
    
    while (hasMorePages) {
      try {
        const response = await this.apiClient.get('/api/v4/site/catalog/products/', {
          params: {
            categoryId: categoryId,
            cityId: this.cityId,
            page: pageNum,
            limit: 32
          }
        });
        
        const data = response.data;
        const pageProducts = data?.products || [];
        const totalCount = data?.totalCount || data?.total || 0;
        
        if (pageProducts.length === 0) {
          if (pageNum === 1) {
            log(`        Нет товаров (пропускаем)`);
          }
          hasMorePages = false;
        } else {
          let newCount = 0;
          pageProducts.forEach((item: any) => {
            const product = this.convertApiToProduct(item, category);
            if (product && !seenIds.has(product.id as number)) {
              seenIds.add(product.id as number);
              products.push(product);
              newCount++;
            }
          });
          
          const totalPages = Math.ceil(totalCount / 32);
          
          if (pageNum === 1 || pageNum % 5 === 0 || pageNum === totalPages) {
            log(`        Стр. ${pageNum}/${totalPages}: +${newCount} новых (всего: ${products.length}/${totalCount})`);
          }
          
          if (pageNum >= totalPages) {
            hasMorePages = false;
          } else {
            pageNum++;
          }
        }
        
        await delay(300);
        
      } catch (error: any) {
        log(`        Ошибка на стр. ${pageNum}: ${error.message}`, 'error');
        hasMorePages = false;
      }
    }
    
    if (products.length > 0) {
      log(`       Готово: ${products.length} товаров`);
    }
    return products;
  }

  private convertApiToProduct(item: any, category: Category): Product | null {
    const name = cleanText(item.title || '');
    if (!name || name.length < 3) return null;
    
    let price: number | undefined;
    let oldPrice: number | undefined;
    let availableCount: number | undefined;
    let supplierArticle: string | undefined;
    let weight: number | undefined;
    
    if (item.variants && Array.isArray(item.variants) && item.variants.length > 0) {
      const availableVariant = item.variants.find((v: any) => v.availableCount > 0) || item.variants[0];
      
      if (Array.isArray(availableVariant.price)) {
        price = availableVariant.price[0];
        oldPrice = availableVariant.price[1] !== availableVariant.price[0] ? availableVariant.price[1] : undefined;
      }
      
      availableCount = availableVariant.availableCount;
      supplierArticle = availableVariant.supplierArticle;
      weight = availableVariant.weight;
    }
    
    const images: any[] = [];
    if (item.thumbnails && Array.isArray(item.thumbnails)) {
      item.thumbnails.forEach((thumb: string, idx: number) => {
        images.push({
          url: thumb,
          alt: item.thumbnailAlts?.[idx] || name,
          position: idx
        });
      });
    }
    
    const mainImage = images.length > 0 ? images[0].url : undefined;
    
    const relativeUrl = item.url || '';
    const url = relativeUrl ? `https://www.petshop.ru/catalog/${relativeUrl}/` : '';
    
    const brand = item.brandName || undefined;
    const article = supplierArticle || item.supplierArticle || item.externalId?.toString() || '';
    
    const tags: string[] = [];
    if (item.variants && item.variants.length > 0) {
      const badges = item.variants[0].badges || [];
      badges.forEach((badge: any) => {
        if (badge.title) {
          if (badge.title.includes('НОВИНКА') || badge.code === 'new') tags.push('НОВИНКА');
          else if (badge.title.includes('-') || badge.code === 'sale') tags.push('АКЦИЯ');
          else if (badge.title.includes('ХИТ') || badge.code === 'hit') tags.push('ХИТ');
          else tags.push(badge.title.toUpperCase());
        }
      });
    }
    
    const inStock = availableCount !== undefined ? availableCount > 0 : true;
    
    return {
      id: item.currentId || item.externalId || 0,
      article,
      name,
      slug: relativeUrl,
      url,
      category,
      brand,
      images,
      mainImage,
      price,
      oldPrice,
      currency: price ? 'RUB' : undefined,
      inStock,
      stockQuantity: availableCount?.toString(),
      specifications: [],
      tags: [...new Set(tags)],
      isNew: tags.includes('НОВИНКА'),
      isSale: tags.includes('АКЦИЯ'),
      isHit: tags.includes('ХИТ'),
      weight: weight ? `${weight}г` : undefined,
      parsedAt: new Date().toISOString(),
      sourceUrl: url,
    };
  }

  private createSummary(
    products: Product[], 
    categoryStats: { name: string; productCount: number }[],
    brandStats: { [key: string]: number }
  ): ParsingSummary {
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
    
    const tagCounts: { [key: string]: number } = {};
    products.forEach(product => {
      product.tags.forEach(tag => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    });
    
    const tags = Object.entries(tagCounts).map(([name, count]) => ({ name, count }));
    const brands = Object.entries(brandStats)
      .map(([name, count]) => ({ name, count }))
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
    } as any;
  }
}