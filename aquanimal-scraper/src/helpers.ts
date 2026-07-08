import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs-extra';
import * as path from 'path';

export const delay = (ms: number): Promise<void> => 
  new Promise(resolve => setTimeout(resolve, ms));

export function createHttpClient(baseURL: string, maxRetries: number = 3): AxiosInstance {
  const client = axios.create({
    baseURL,
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });

  client.interceptors.response.use(
    (response) => response,
    async (error) => {
      const config = error.config;
      if (!config || config._retryCount >= maxRetries) {
        return Promise.reject(error);
      }
      config._retryCount = config._retryCount || 0;
      config._retryCount++;
      const backoffDelay = Math.pow(2, config._retryCount) * 1000;
      console.log(`Retry ${config._retryCount}/${maxRetries} for ${config.url}`);
      await delay(backoffDelay);
      return client(config);
    }
  );

  return client;
}

export async function saveToJson(
  data: any, 
  filePath: string, 
  prettyPrint: boolean = true
): Promise<void> {
  await fs.ensureDir(path.dirname(filePath));
  
  try {
    JSON.stringify(data);
  } catch (error) {
    throw new Error('Данные не могут быть сериализованы в JSON');
  }
  
  const jsonString = prettyPrint 
    ? JSON.stringify(data, null, 2) 
    : JSON.stringify(data);
  
  await fs.writeFile(filePath, jsonString, 'utf-8');
  console.log(`Сохранено: ${filePath}`);
}

export async function loadFromJson<T>(filePath: string): Promise<T | null> {
  try {
    if (!await fs.pathExists(filePath)) {
      return null;
    }
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch (error) {
    console.error(`Ошибка загрузки JSON из ${filePath}:`, error);
    return null;
  }
}

export function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/[\r\n]+/g, ' ').trim();
}

export function extractNumber(text: string): number | undefined {
  const match = text.match(/[\d\s.,]+/);
  if (!match) return undefined;
  const cleaned = match[0].replace(/\s/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? undefined : num;
}

export function toAbsoluteUrl(baseUrl: string, relativeUrl: string): string {
  try {
    new URL(relativeUrl);
    return relativeUrl;
  } catch {
    const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const rel = relativeUrl.startsWith('/') ? relativeUrl : `/${relativeUrl}`;
    return `${base}${rel}`;
  }
}

export function log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  const timestamp = new Date().toISOString();
  const prefix = level === 'error' ? '' : level === 'warn' ? '' : '';
  console.log(`${prefix} [${timestamp}] ${message}`);
}

export function extractSku(text: string): string {
  const match = text.match(/Артикул[:\s]*(\d+)/i);
  return match ? match[1].trim() : '';
}