import * as fs from 'fs-extra';
import * as path from 'path';

export const delay = (ms: number): Promise<void> => 
  new Promise(resolve => setTimeout(resolve, ms));

export async function saveToJson(
  data: any, 
  filePath: string, 
  prettyPrint: boolean = true
): Promise<void> {
  await fs.ensureDir(path.dirname(filePath));
  
  try {
    JSON.stringify(data);
  } catch (error) {
    console.error(' Ошибка валидации JSON:', error);
    throw new Error('Данные не могут быть сериализованы в JSON');
  }
  
  const jsonString = prettyPrint 
    ? JSON.stringify(data, null, 2) 
    : JSON.stringify(data);
  
  await fs.writeFile(filePath, jsonString, 'utf-8');
  console.log(` Сохранено: ${filePath}`);
}

export function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/[\r\n]+/g, ' ').trim();
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