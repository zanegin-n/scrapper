import { GstriolScraper } from './scraper';
import { ScraperConfig } from './types';
import * as path from 'path';

async function main() {
  const config: ScraperConfig = {
    baseUrl: 'https://gc-triol.com',
    outputDir: path.join(__dirname, '../output'),
    jsonPrettyPrint: true,
    delayBetweenRequests: 500, 
    splitByCategory: true       
  };

  try {
    const scraper = new GstriolScraper(config); 
    await scraper.run();
    
    console.log('\n🎉 Результаты сохранены в папке output/');
  } catch (error) {
    console.error('❌ Критическая ошибка:', error);
    process.exit(1);
  }
}

main();
