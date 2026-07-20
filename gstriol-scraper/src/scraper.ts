import axios from 'axios';
import { Product, Category, ScraperConfig, ParsingSummary, ProductSpecification } from './types';
import { delay, cleanText, toAbsoluteUrl, log, saveToJson } from './helpers';
import * as path from 'path';
import puppeteer from 'puppeteer';

const API_BASE = 'https://api.gc-triol.com/api/ru';
const SITE_BASE = 'https://gc-triol.com';

export class GstriolScraper {
  private config: ScraperConfig;
  private startTime: number = 0;
  private browser: any;
  private httpClient = axios.create({
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
    }
  });

  constructor(config: ScraperConfig) {
    this.config = config;
  }

  async run(): Promise<void> {
    this.startTime = Date.now();
    log('🚀 Запуск парсера gc-triol.com');
    
    this.browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    try {
      const mainCategories = await this.getMainCategoriesWithSubcategories();
      log(`📁 Найдено основных категорий: ${mainCategories.length}`);
      
      const allProducts: Product[] = [];
      const categoryStats: { name: string; productCount: number }[] = [];

      for (const mainCat of mainCategories) {
        log(`\n📂 Парсинг категории: ${mainCat.name}`);
        
        const products = await this.parseMainCategory(mainCat);
        
        if (products.length === 0) {
          log(`⚠️ Категория "${mainCat.name}" пуста или недоступна`, 'info'); // Исправлено 'warn' на 'info'
          continue;
        }
        
        mainCat.productCount = products.length;
        categoryStats.push({ name: mainCat.name, productCount: products.length });
        allProducts.push(...products);
        
        if (this.config.splitByCategory) {
          await saveToJson(
            products,
            path.join(this.config.outputDir, 'products-by-category', `${mainCat.id}.json`),
            this.config.jsonPrettyPrint
          );
        }
        
        await delay(this.config.delayBetweenRequests || 500);
      }
      
      await saveToJson(allProducts, path.join(this.config.outputDir, 'products.json'), this.config.jsonPrettyPrint);
      
      const summary = this.createSummary(allProducts, mainCategories, categoryStats);
      await saveToJson(summary, path.join(this.config.outputDir, 'summary.json'), this.config.jsonPrettyPrint);
      
      const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
      log(`\n✅ Парсинг завершен за ${duration}с! Всего товаров: ${allProducts.length}`);
      
    } catch (error: any) {
      log(`❌ Критическая ошибка: ${error.message}`, 'error');
    } finally {
      if (this.browser) {
        await this.browser.close();
      }
    }
  }

  private async getMainCategoriesWithSubcategories(): Promise<any[]> {
    log('🔍 Загрузка структуры каталога...');
    try {
      const response = await this.httpClient.get(`${API_BASE}/catalog/`);
      const allCategories = response.data.categories;
      
      const mainCategoryNames = [
        'Товары для собак', 'Товары для кошек', 'Товары для мелких животных',
        'Товары для птиц', 'Аквариумистика', 'Террариумистика'
      ];
      
      const result: any[] = [];
      for (const cat of allCategories) {
        const matchedName = mainCategoryNames.find(n => cat.title === n);
        if (matchedName && cat.children && cat.children.length > 0) {
          result.push({
            id: cat.path,
            name: matchedName,
            path: cat.path,
            subcategories: cat.children.map((child: any) => ({
              path: `${cat.path},${child.path.split(',').pop()}`,
              name: child.title,
              count: child.count
            }))
          });
        }
      }
      return result;
    } catch (error: any) {
      log(`❌ Ошибка загрузки каталога: ${error.message}`, 'error');
      return [];
    }
  }

  private async parseMainCategory(mainCat: any): Promise<Product[]> {
    const products: Product[] = [];
    const seenIds = new Set<string | number>();
    
    log(`   Подкатегорий: ${mainCat.subcategories.length}`);
    
    for (const subcat of mainCat.subcategories) {
      log(`   ▶️ ${subcat.name} (${subcat.path})`);
      const subcatProducts = await this.parseSubcategory(subcat.path);
      
      let newCount = 0;
      for (const product of subcatProducts) {
        if (!seenIds.has(product.id as any)) {
          seenIds.add(product.id as any);
          products.push(product);
          newCount++;
        }
      }
      log(`   📊 Итого в "${subcat.name}": ${subcatProducts.length} товаров, новых: ${newCount} (всего: ${products.length})`);
      await delay(500);
    }
    return products;
  }

  private async parseSubcategory(subcatPath: string): Promise<Product[]> {
    const products: Product[] = [];
    let pageNum = 1;
    let hasMorePages = true;
    
    const page = await this.browser.newPage();
    await page.setDefaultNavigationTimeout(15000);
    
    while (hasMorePages) {
      const url = `${API_BASE}/catalog/products/?path=${subcatPath}&p=${pageNum}`;
      
      try {
        const response = await this.httpClient.get(url);
        const data = response.data;
        
        if (!data.products || data.products.length === 0) {
          hasMorePages = false;
          break;
        }

        for (const apiProduct of data.products) {
          const product = this.mapApiProductToProduct(apiProduct, subcatPath);
          if (product) {
            log(`      🕷️ Забираем характеристики для: ${product.name.substring(0, 40)}...`);
            
            const specs = await this.getProductCharacteristics(page, product.url);
            if (specs.length > 0) {
              product.specifications = specs;
              log(`      ✅ Найдено характеристик: ${specs.length}`);
            } else {
              log(`      ⚠️ Характеристики не найдены на странице`, 'info');
            }
            
            products.push(product);
            // ❗️ УДАЛЕНО: break; (Эта строка останавливала цикл после первого товара!)
          }
        }

        if (pageNum >= (data.pages || 1)) {
          hasMorePages = false;
        } else {
          pageNum++;
        }
        
        await delay(this.config.delayBetweenRequests || 500);
        
      } catch (error: any) {
        log(`   ❌ Ошибка на странице ${pageNum}: ${error.message}`, 'error');
        hasMorePages = false;
      }
    }
    
    await page.close();
    return products;
  }

  private async getProductCharacteristics(page: any, url: string): Promise<ProductSpecification[]> {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await delay(800);

      const specs = await page.evaluate(() => {
        const result: { name: string; value: string }[] = [];
        const rows = document.querySelectorAll('.product__char-row, .product-mobile-about__char-row');
        
        rows.forEach((row: any) => {
          const labelEl = row.querySelector('.product__char-label, .product-mobile-about__char-label');
          const valueEl = row.querySelector('.product__char-value, .product-mobile-about__char-value');
          
          if (labelEl && valueEl) {
            const name = labelEl.textContent?.trim().replace(':', '') || '';
            const value = valueEl.textContent?.trim() || '';
            if (name && value && name.length > 1) {
              result.push({ name, value });
            }
          }
        });
        return result;
      });
      return specs;
    } catch (error) {
      return [];
    }
  }

  private mapApiProductToProduct(apiProduct: any, subcatPath: string): Product | null {
    try {
      const name = cleanText(apiProduct.title || '');
      if (!name || name.length < 3) return null;
      
      const brand = apiProduct.brand?.title || undefined;
      const article = apiProduct.sku_full || '';
      const barcode = apiProduct.barcode || undefined;
      const description = apiProduct.description ? cleanText(apiProduct.description) : undefined;
      const slug = apiProduct.slug || '';
      const url = slug ? `${SITE_BASE}/product/${slug}/` : '';

      const images = (apiProduct.images || []).map((img: any, idx: number) => ({
        url: img.image?.url ? toAbsoluteUrl(SITE_BASE, img.image.url) : '',
        alt: img.image?.alt || '',
        position: idx
      })).filter((img: any) => img.url);
      
      const inStock = apiProduct.in_stock === true;
      // Исправлено: задаем '0' по умолчанию, чтобы тип всегда был string
      const stockQuantity = apiProduct.amount ? String(apiProduct.amount) : '0'; 
      
      const tags: string[] = [];
      if (apiProduct.labels && Array.isArray(apiProduct.labels)) {
        for (const label of apiProduct.labels) {
          const tagTitle = label.title?.toUpperCase();
          if (tagTitle && !tags.includes(tagTitle)) {
            tags.push(tagTitle);
          }
        }
      }

      const pathParts = subcatPath.split(',');
      const category: Category = {
        id: pathParts[0],
        name: this.getCategoryName(pathParts[0]),
        url: `${SITE_BASE}/catalog/${pathParts[0]}/`
      };
      
      return {
        id: apiProduct.id,
        article,
        name,
        slug,
        url,
        category,
        brand,
        description,
        images,
        mainImage: images.length > 0 ? images[0].url : undefined,
        barcode,
        inStock,
        stockQuantity,
        specifications: [], 
        tags,
        isNew: tags.includes('НОВИНКА'),
        isSale: tags.includes('АКЦИЯ') || tags.includes('РАСПРОДАЖА'),
        isHit: tags.includes('ХИТ'),
        parsedAt: new Date().toISOString(),
        sourceUrl: url,
      };
    } catch (error: any) {
      log(`      ⚠️ Ошибка маппинга товара: ${error.message}`, 'info'); // Исправлено 'warn' на 'info'
      return null;
    }
  }

  private getCategoryName(slug: string): string {
    const names: { [key: string]: string } = {
      'tovary-dlia-sobak': 'Товары для собак',
      'tovary-dlia-koshek': 'Товары для кошек',
      'tovary-dlia-melkikh-zhivotnykh': 'Товары для мелких животных',
      'tovary-dlia-ptits': 'Товары для птиц',
      'akvariumistika': 'Аквариумистика',
      'terrariumistika': 'Террариумистика',
    };
    return names[slug] || slug;
  }

  private createSummary(
    products: Product[], 
    categories: any[], 
    categoryStats: { name: string; productCount: number }[]
  ): ParsingSummary {
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
    
    const tagCounts: { [key: string]: number } = {};
    const brandCounts: { [key: string]: number } = {};
    
    products.forEach(product => {
      product.tags.forEach(tag => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
      if (product.brand) {
        brandCounts[product.brand] = (brandCounts[product.brand] || 0) + 1;
      }
    });
    
    const tags = Object.entries(tagCounts).map(([name, count]) => ({ name, count }));
    const brands = Object.entries(brandCounts).map(([name, count]) => ({ name, count }));
    
    return {
      totalProducts: products.length,
      totalCategories: categories.length,
      parsedAt: new Date().toISOString(),
      duration: `${duration}s`,
      categories: categoryStats,
      tags,
      brands, // Добавлено поле brands
    };
  }
}
