import * as cheerio from 'cheerio';
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

type CheerioType = ReturnType<typeof cheerio.load>;

const MAIN_SECTIONS = [
  { id: 'cats',      name: 'Кошки',              url: '/catalog/dlya-koshek/' },
  { id: 'dogs',      name: 'Собаки',             url: '/catalog/dlya-sobak/' },
  { id: 'birds',     name: 'Птицы',              url: '/catalog/dlya-ptits/' },
  { id: 'rodents',   name: 'Грызуны',            url: '/catalog/dlya-gryzunov/' },
  { id: 'aquarium',  name: 'Аквариумистика',     url: '/catalog/akvariumistika/' },
  { id: 'vetapteka', name: 'Ветаптека',          url: '/catalog/vetapteka/' },
  { id: 'home',      name: 'Дом, сад, огород',   url: '/catalog/dom-sad-ogorod/' },
  { id: 'sxzh',      name: 'СХЖ',                url: '/catalog/skhzh/' },
  { id: 'books',     name: 'Книги и журналы',    url: '/catalog/knigi-i-zhurnaly/' },
  { id: 'puppies',   name: 'Для щенят',          url: '/catalog/dlya-shchenyat/' },
  { id: 'kittens',   name: 'Для котят',          url: '/catalog/dlya-kotyat/' },
];

export class WesternPetsScraper {
  private config: ScraperConfig;
  private browser: any;
  private startTime: number = 0;

  constructor(config: ScraperConfig) {
    this.config = config;
  }

  async run(): Promise<void> {
    this.startTime = Date.now();
    
    this.browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking'
      ]
    });
    
    try {
      const allSubcategories = await this.getAllSubcategories();
      log(` Всего подкатегорий найдено: ${allSubcategories.length}`);
      
      const allProducts: Product[] = [];
      const categoryStats: { name: string; productCount: number }[] = [];

      const page = await this.browser.newPage();
      
      await page.setRequestInterception(true);
      page.on('request', (req: any) => {
        const type = req.resourceType();
        const url = req.url();
        if (['image', 'stylesheet', 'font', 'media'].includes(type) ||
            url.includes('yandex') || url.includes('google') || 
            url.includes('metrika') || url.includes('analytics')) {
          req.abort();
        } else {
          req.continue();
        }
      });
      
      for (const section of MAIN_SECTIONS) {
        log(`\n === РАЗДЕЛ: ${section.name} ===`);
        
        const sectionUrlPath = section.url.replace('/catalog/', '').replace('/', '');
        const sectionSubcats = allSubcategories.filter(subcat => {
          return subcat.url.includes(sectionUrlPath) || 
                 subcat.parentSection === section.id;
        });
        
        log(`    Подкатегорий в разделе: ${sectionSubcats.length}`);
        
        if (sectionSubcats.length === 0) {
          log(`   Подкатегорий не найдено, пропускаем`, 'warn');
          continue;
        }
        
        const sectionProducts: Product[] = [];
        
        for (const subcat of sectionSubcats) {
          try {
            const products = await this.parseSubcategoryFast(page, subcat);
            
            if (products.length > 0) {
              subcat.productCount = products.length;
              categoryStats.push({
                name: `${section.name} > ${subcat.name}`,
                productCount: products.length
              });
              
              sectionProducts.push(...products);
              allProducts.push(...products);
            }
          } catch (error) {
            log(`       ❌ Ошибка в "${subcat.name}": ${error}`, 'error');
          }
        }
        
        if (sectionProducts.length > 0) {
          const fileName = `${section.id}.json`;
          const filePath = path.join(this.config.outputDir, fileName);
          await saveToJson(sectionProducts, filePath, this.config.jsonPrettyPrint);
          log(`   Сохранено: ${fileName} (${sectionProducts.length} товаров)`);
        } else {
          log(`   В разделе нет товаров`, 'warn');
        }
        
        await delay(100);
      }
      
      await page.close();
      
      await saveToJson(
        allProducts,
        path.join(this.config.outputDir, 'products.json'),
        this.config.jsonPrettyPrint
      );
      
      const summary = this.createSummary(allProducts, categoryStats);
      await saveToJson(
        summary,
        path.join(this.config.outputDir, 'summary.json'),
        this.config.jsonPrettyPrint
      );
      
      const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
      log(`\n Завершено за ${duration}с! Всего товаров: ${allProducts.length}`);
      log(` Созданные файлы:`);
      MAIN_SECTIONS.forEach(s => {
        log(`   - ${s.id}.json — ${s.name}`);
      });
      log(`   - products.json — все товары вместе`);
      log(`   - summary.json — итоговая статистика`);
      
    } finally {
      await this.browser.close();
    }
  }

  private async getAllSubcategories(): Promise<Category[]> {
    const page = await this.browser.newPage();
    const subcategories: Category[] = [];
    const seenUrls = new Set<string>();
    
    try {
      await page.setRequestInterception(true);
      page.on('request', (req: any) => {
        if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
          req.abort();
        } else {
          req.continue();
        }
      });
      
      for (const section of MAIN_SECTIONS) {
        log(`    Сканируем: ${section.name}`);
        
        try {
          await page.goto(`https://westernpets.ru${section.url}`, {
            waitUntil: 'domcontentloaded',
            timeout: 15000
          });
          
          await delay(300);
          
          const html = await page.content();
          const $ = cheerio.load(html);
          
          $('.bx_catalog_tile_ul li').each((_: number, el: any) => {
            const $li = $(el);
            const $link = $li.find('a').first();
            const href = $link.attr('href');
            
            if (href && href.includes('/catalog/')) {
              const fullText = cleanText($li.text());
              const match = fullText.match(/(.+?)\s*\((\d+)\)/);
              
              if (match) {
                const name = match[1].trim();
                const count = parseInt(match[2]);
                const absoluteUrl = toAbsoluteUrl('https://westernpets.ru', href);
                
                if (!seenUrls.has(absoluteUrl)) {
                  seenUrls.add(absoluteUrl);
                  const id = href.split('/').filter(Boolean).pop() || '';
                  
                  subcategories.push({
                    id,
                    name,
                    url: absoluteUrl,
                    productCount: count,
                    parentSection: section.id
                  } as any);
                }
              }
            }
          });
          
          $('a.root-item').each((_: number, el: any) => {
            const $a = $(el);
            const href = $a.attr('href');
            const text = cleanText($a.text());
            
            if (href && href.includes('/catalog/') && text) {
              const match = text.match(/(.+?)\s*\((\d+)\)/);
              
              if (match) {
                const name = match[1].trim();
                const count = parseInt(match[2]);
                const absoluteUrl = toAbsoluteUrl('https://westernpets.ru', href);
                
                const pathParts = href.split('/').filter(Boolean);
                if (pathParts.length >= 2 && !seenUrls.has(absoluteUrl)) {
                  seenUrls.add(absoluteUrl);
                  const id = pathParts[pathParts.length - 1];
                  
                  subcategories.push({
                    id,
                    name,
                    url: absoluteUrl,
                    productCount: count,
                    parentSection: section.id
                  } as any);
                }
              }
            }
          });
          
        } catch (error) {
          log(`   Ошибка сканирования "${section.name}": ${error}`, 'error');
        }
      }
      
      log(`   Всего подкатегорий: ${subcategories.length}`);
      
    } finally {
      await page.close();
    }
    
    return subcategories;
  }

  private async parseSubcategoryFast(page: any, subcategory: Category): Promise<Product[]> {
    const products: Product[] = [];
    let pageNum = 1;
    let hasMorePages = true;
    
    log(`     ${subcategory.name} (${subcategory.productCount || '?'} товаров)`);
    
    while (hasMorePages) {
      const pageUrl = pageNum === 1 
        ? subcategory.url 
        : `${subcategory.url}?PAGEN_1=${pageNum}`;
      
      try {
        await page.goto(pageUrl, { 
          waitUntil: 'domcontentloaded',
          timeout: 20000 
        });
        
        await page.waitForSelector('.t_1_section', { timeout: 5000 }).catch(() => {});
        await delay(100);
        
        const html = await page.content();
        const $ = cheerio.load(html);
        
        const pageProducts = this.extractProductsFromPage($, subcategory, pageNum);
        
        if (pageProducts.length === 0) {
          hasMorePages = false;
        } else {
          products.push(...pageProducts);
          
          if (pageNum === 1 || pageNum % 5 === 0) {
            log(`        Стр. ${pageNum}: +${pageProducts.length} (всего: ${products.length})`);
          }
          
          const nextPageNum = pageNum + 1;
          const hasNext = $(`a[href*="PAGEN_1=${nextPageNum}"]`).length > 0;
          
          if (!hasNext || pageProducts.length < 16) {
            hasMorePages = false;
          } else {
            pageNum++;
          }
        }
        
        await delay(100);
        
      } catch (error) {
        hasMorePages = false;
      }
    }
    
    log(`        Готово: ${products.length} товаров`);
    return products;
  }

  private extractProductsFromPage($: CheerioType, category: Category, pageNum: number): Product[] {
    const products: Product[] = [];
    const processedKeys = new Set<string>();
    
    $('.t_1_section').each((index: number, element: any) => {
      try {
        const $card = $(element);
        const product = this.parseProductCard($card, category, pageNum, index);
        
        if (product) {
          const key = product.article || product.url;
          if (key && !processedKeys.has(key)) {
            processedKeys.add(key);
            products.push(product);
          }
        }
      } catch (error) {
      }
    });
    
    return products;
  }

  private parseProductCard($card: any, category: Category, pageNum: number, index: number): Product | null {
  // Название
  const name = cleanText($card.find('.bxr-element-name a').first().text());
  if (!name || name.length < 3) return null;
  
  const href = $card.find('.bxr-element-name a').first().attr('href') ||
               $card.find('.bxr-item-image-wrap').first().attr('href');
  const url = href ? toAbsoluteUrl('https://westernpets.ru', href) : '';
  
  const articleText = $card.find('.bxr-element-article').first().text();
  const articleMatch = articleText.match(/Арт[:\s]*(\d+)/i);
  const article = articleMatch ? articleMatch[1] : '';

  let price: number | undefined;
  let oldPrice: number | undefined;
  
  const priceSelectors = [
    '.bxr-element-price .bxr-market-current-price',
    '.bxr-element-price .bxr-format-price',
    '.bxr-market-current-price',
    '.bxr-element-price',
    '.price',
    '[itemprop="price"]'
  ];
  
  for (const selector of priceSelectors) {
    const priceText = $card.find(selector).first().text();
    if (priceText) {
      const priceMatch = priceText.match(/([\d\s.,]+)/);
      if (priceMatch) {
        price = parseFloat(priceMatch[1].replace(/\s/g, '').replace(',', '.'));
        if (price > 0) break;
      }
    }
  }

  const oldPriceText = $card.find('.bxr-market-old-price, .old-price').first().text();
  if (oldPriceText) {
    const oldPriceMatch = oldPriceText.match(/([\d\s.,]+)/);
    if (oldPriceMatch) {
      oldPrice = parseFloat(oldPriceMatch[1].replace(/\s/g, '').replace(',', '.'));
    }
  }

  let imgSrc = $card.find('.bxr-element-image img').first().attr('src') ||
               $card.find('.bxr-element-image img').first().attr('data-src') ||
               $card.find('.bxr-item-image-wrap img').first().attr('src');

  if (imgSrc) {
    // Убираем resize_cache и берём оригинал
    imgSrc = imgSrc.replace(/\/resize_cache\/iblock\/[^\/]+\/\d+_\d+_\d+\//, '/upload/iblock/');
    imgSrc = imgSrc.replace(/\.\d+x\d+_q\d+\.jpg$/, '.jpg');
  }
  
  const images = imgSrc && !imgSrc.includes('no-image') ? [{
    url: toAbsoluteUrl('https://westernpets.ru', imgSrc),
    alt: name,
    position: 0
  }] : [];

  const availText = $card.find('.bxr-element-avail, .bxr-instock-wrap').first().text();
  const inStock = /в наличии/i.test(availText);
  
  let brand: string | undefined;

  const brandText = $card.find('.bxr-element-brand, .brand, [itemprop="brand"]').first().text();
  if (brandText) {
    brand = cleanText(brandText);
  } else {
    const brandMatch = name.match(/^["']([^"']+)["']/);
    if (brandMatch) {
      brand = brandMatch[1];
    }
  }

  const tags: string[] = [];
  
  const tagElements = $card.find('.bxr-ribbon-marker, .bxr-label, .label, .tag');
  for (let i = 0; i < tagElements.length; i++) {
    const tagElement = tagElements.eq(i);
    const tagText = cleanText(tagElement.text());
    if (tagText) {
      const upperTag = tagText.toUpperCase();
      if (upperTag.includes('НОВИНКА') || upperTag.includes('NEW')) tags.push('НОВИНКА');
      if (upperTag.includes('АКЦИЯ') || upperTag.includes('SALE') || upperTag.includes('СКИДКА')) tags.push('АКЦИЯ');
      if (upperTag.includes('ХИТ') || upperTag.includes('HIT')) tags.push('ХИТ');
    }
  }
  
  const cardText = $card.text();
  if (/новинка|new/i.test(cardText) && !tags.includes('НОВИНКА')) tags.push('НОВИНКА');
  if (/акция|sale|скидка/i.test(cardText) && !tags.includes('АКЦИЯ')) tags.push('АКЦИЯ');
  if (/хит|hit/i.test(cardText) && !tags.includes('ХИТ')) tags.push('ХИТ');
  
  const stockText = $card.find('.bxr-element-avail').first().text();
  const stockMatch = stockText.match(/(\d+)\s*шт/i);
  const stockQuantity = stockMatch ? stockMatch[1] : undefined;
  
  return {
    id: article || `product_${pageNum}_${index}`,
    article,
    name,
    slug: url.split('/').filter(Boolean).pop() || '',
    url,
    category,
    brand,
    images,
    mainImage: images.length > 0 ? images[0].url : undefined,
    price,
    oldPrice,
    currency: price ? 'RUB' : undefined,
    inStock,
    stockQuantity,
    specifications: [],
    tags,
    isNew: tags.includes('НОВИНКА'),
    isSale: tags.includes('АКЦИЯ'),
    isHit: tags.includes('ХИТ'),
    parsedAt: new Date().toISOString(),
    sourceUrl: url,
  };
}

  private createSummary(
    products: Product[], 
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
      totalCategories: categoryStats.length,
      parsedAt: new Date().toISOString(),
      duration: `${duration}s`,
      categories: categoryStats,
      tags,
    };
  }
}