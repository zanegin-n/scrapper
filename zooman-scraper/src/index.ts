import { ZoomanScraper } from './scraper';
import { ScraperConfig } from './types';
import * as path from 'path';

async function main() {
  const config: ScraperConfig = {
    baseUrl: 'https://zooman.ru',
    outputDir: path.join(__dirname, '../output'),
    delayBetweenRequests: 500,
    maxRetries: 3,
    saveImages: false,
    imageDir: path.join(__dirname, '../output/images'),
    jsonPrettyPrint: true,
    splitByCategory: true,
  };

  try {
    const scraper = new ZoomanScraper(config);
    await scraper.run();
  } catch (error) {
    console.error('❌ Критическая ошибка:', error);
    process.exit(1);
  }
}

main();