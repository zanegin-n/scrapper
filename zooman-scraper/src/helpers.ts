import * as fs from 'fs';
import * as path from 'path';

export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const cleanText = (text: string): string => {
  return text.replace(/\s+/g, ' ').trim();
};

export const toAbsoluteUrl = (baseUrl: string, relativeUrl: string): string => {
  if (relativeUrl.startsWith('http')) return relativeUrl;
  return new URL(relativeUrl, baseUrl).toString();
};

export const log = (message: string, type: 'info' | 'warn' | 'error' = 'info') => {
  const timestamp = new Date().toISOString();
  const prefix = type === 'error' ? '❌' : type === 'warn' ? '⚠️' : '✓';
  console.log(`${prefix} [${timestamp}] ${message}`);
};

export const saveToJson = async (data: any, filePath: string, pretty: boolean = true) => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  const jsonContent = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  fs.writeFileSync(filePath, jsonContent, 'utf8');
};