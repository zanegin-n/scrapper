import { ZoomanScraper } from './scraper';
import { ScraperConfig } from './types';
import * as path from 'path';

const config: ScraperConfig = {
  baseUrl: 'https://zooman.ru',
  outputDir: path.join(__dirname, '..', 'output'),
  delayBetweenRequests: 400,
  maxRetries: 3,
  saveImages: false,
  imageDir: path.join(__dirname, '..', 'output', 'images'),
  jsonPrettyPrint: true,
  splitByCategory: true,
};

async function main() {
  const scraper = new ZoomanScraper(config);
  
  process.on('SIGINT', () => {
    process.exit(0);
  });

  try {
    await scraper.run();
  } catch (error) {
    console.error('❌ Критическая ошибка:', error);
    process.exit(1);
  }
}

main();
