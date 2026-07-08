import { PetshopScraper } from './scraper';
import { ScraperConfig } from './types';
import * as path from 'path';

async function main() {
  const config: ScraperConfig = {
    baseUrl: 'https://www.petshop.ru',
    outputDir: path.join(__dirname, '../output'),
    delayBetweenRequests: 300,
    maxRetries: 3,
    saveImages: false,
    imageDir: path.join(__dirname, '../output/images'),
    jsonPrettyPrint: true,
    splitByCategory: true,
    categories: [],
  };

  try {
    const scraper = new PetshopScraper(config);
    await scraper.run();
  } catch (error) {
    console.error(' Критическая ошибка:', error);
    process.exit(1);
  }
}

main();