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

const API_BASE = 'https://api.gc-triol.com/api/ru';
const SITE_BASE = 'https://gc-triol.com';

export class GstriolScraper {
  private config: ScraperConfig;
  private startTime: number = 0;
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
    log(' Запуск API-парсера gc-triol.com');
    
    try {
      const mainCategories = await this.getMainCategoriesWithSubcategories();
      log(`Найдено основных категорий: ${mainCategories.length}`);
      
      const allProducts: Product[] = [];
      const categoryStats: { name: string; productCount: number }[] = [];

      for (const mainCat of mainCategories) {
        log(` Парсинг категории: ${mainCat.name}`);
        
        const products = await this.parseMainCategory(mainCat);
        
        if (products.length === 0) {
          log(` Категория "${mainCat.name}" пуста, пропускаем`, 'warn');
          continue;
        }
        
        mainCat.productCount = products.length;
        categoryStats.push({
          name: mainCat.name,
          productCount: products.length
        });
        
        allProducts.push(...products);
        
        if (this.config.splitByCategory) {
          await saveToJson(
            products,
            path.join(this.config.outputDir, 'products-by-category', `${mainCat.id}.json`),
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

      const summary = this.createSummary(allProducts, mainCategories, categoryStats);
      await saveToJson(
        summary,
        path.join(this.config.outputDir, 'summary.json'),
        this.config.jsonPrettyPrint
      );
      
      const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
      log(` Парсинг завершен за ${duration}с! Товаров: ${allProducts.length}`);
      
    } catch (error) {
      log(` Критическая ошибка: ${error}`, 'error');
    }
  }

  private async getMainCategoriesWithSubcategories(): Promise<any[]> {
    const response = await this.httpClient.get(`${API_BASE}/catalog/`);
    const allCategories = response.data.categories;
    
    const mainCategoryNames = [
      'Товары для собак',
      'Товары для кошек',
      'Товары для мелких животных',
      'Товары для птиц',
      'Аквариумистика',
      'Террариумистика'
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
  }

  private async parseMainCategory(mainCat: any): Promise<Product[]> {
    const products: Product[] = [];
    const seenIds = new Set<number>();
    
    log(`   Подкатегорий: ${mainCat.subcategories.length}`);
    
    for (const subcat of mainCat.subcategories) {
      log(`   ${subcat.name} (${subcat.path})`);
      
      const subcatProducts = await this.parseSubcategory(subcat.path);
      
      let newCount = 0;
      for (const product of subcatProducts) {
        if (!seenIds.has(product.id as any)) {
          seenIds.add(product.id as any);
          products.push(product);
          newCount++;
        }
      }
      
      log(`   Найдено ${subcatProducts.length} товаров, новых: ${newCount} (всего уникальных: ${products.length})`);
      
      await delay(500);
    }
    
    return products;
  }

  private async parseSubcategory(subcatPath: string): Promise<Product[]> {
    const products: Product[] = [];
    let pageNum = 1;
    let hasMorePages = true;
    
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
            products.push(product);
          }
        }

        if (pageNum >= data.pages) {
          hasMorePages = false;
        } else {
          pageNum++;
        }
        
        await delay(this.config.delayBetweenRequests);
        
      } catch (error: any) {
        log(`   Ошибка на странице ${pageNum}: ${error.message}`, 'error');
        hasMorePages = false;
      }
    }
    
    return products;
  }

  private mapApiProductToProduct(apiProduct: any, subcatPath: string): Product | null {
    try {
      const name = cleanText(apiProduct.title || '');
      if (!name || name.length < 3) return null;
      
      const brand = apiProduct.brand?.title || undefined;
      
      const article = apiProduct.sku_full || '';
      
      const barcode = apiProduct.barcode || undefined;
      
      const description = apiProduct.description 
        ? cleanText(apiProduct.description) 
        : undefined;

      const slug = apiProduct.slug || '';
      const url = slug ? `${SITE_BASE}/product/${slug}/` : '';

      const images = (apiProduct.images || []).map((img: any, idx: number) => ({
        url: img.image?.url ? toAbsoluteUrl(SITE_BASE, img.image.url) : '',
        alt: img.image?.alt || '',
        position: idx
      })).filter((img: any) => img.url);
      
      const inStock = apiProduct.in_stock === true;
      const stockQuantity = apiProduct.amount || undefined;
      
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
      
      const product: Product = {
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
      
      const details: string[] = [];
      if (article) details.push(`Артикул: ${article}`);
      if (brand) details.push(`Бренд: ${brand}`);
      if (barcode) details.push(`Штрихкод: ${barcode}`);
      if (inStock) details.push(`В наличии${stockQuantity ? `: ${stockQuantity}` : ''}`);
      if (tags.length > 0) details.push(`Теги: ${tags.join(', ')}`);
      if (description) details.push(`Описание: ${description.length} симв.`);
      
      log(`   Товар: ${name.substring(0, 60)}${name.length > 60 ? '...' : ''} (${details.join(', ') || 'нет данных'})`);
      
      return product;
    } catch (error) {
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