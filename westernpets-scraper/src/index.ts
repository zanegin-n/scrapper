import { WesternPetsScraper } from './scraper';
import { ScraperConfig } from './types';
import * as path from 'path';

async function main() {
  const config: ScraperConfig = {
    baseUrl: 'https://westernpets.ru',
    outputDir: path.join(__dirname, '../output'),
    delayBetweenRequests: 100,
    maxRetries: 3,
    saveImages: false,
    imageDir: path.join(__dirname, '../output/images'),
    jsonPrettyPrint: true,
    splitByCategory: true,
    categories: [],
  };

  try {
    const scraper = new WesternPetsScraper(config);
    await scraper.run();
  } catch (error) {
    console.error(' Критическая ошибка:', error);
    process.exit(1);
  }
}

main();