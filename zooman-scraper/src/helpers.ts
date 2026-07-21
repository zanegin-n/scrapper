import * as fs from 'fs';
import * as path from 'path';

export const delay = (ms: number): Promise<void> => 
  new Promise(resolve => setTimeout(resolve, ms));

export async function saveToJson(
  data: any, 
  filePath: string, 
  prettyPrint: boolean = true
): Promise<void> {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  const jsonString = prettyPrint 
    ? JSON.stringify(data, null, 2) 
    : JSON.stringify(data);
  
  fs.writeFileSync(filePath, jsonString, 'utf-8');
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
  const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';
  console.log(`${prefix} [${timestamp}] ${message}`);
}
