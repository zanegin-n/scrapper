import { AquanimalScraper } from './scraper';
import { ScraperConfig } from './types';
import * as path from 'path';

async function main() {
  const config: ScraperConfig = {
    baseUrl: 'https://www.aquanimal.ru',
    outputDir: path.join(__dirname, '../output'),
    delayBetweenRequests: 1000, 
    maxRetries: 3,
    saveImages: false,
    imageDir: path.join(__dirname, '../output/images'),
    jsonPrettyPrint: true, 
    splitByCategory: true, 
    categories: [], 
  };

  try {
    const scraper = new AquanimalScraper(config);
    await scraper.run();
    
    console.log('\n Результаты сохранены в папке ');
    console.log('  - products.json - все товары');
    console.log('  - products-by-category/ - товары по категориям');
    console.log('  - summary.json - итоговая статистика');
  } catch (error) {
    console.error(' Критическая ошибка:', error);
    process.exit(1);
  }
}

main();