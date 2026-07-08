export interface Category {
  id: string;
  name: string;
  url: string;
  productCount?: number;
  parentSection?: string;
}

export interface ProductImage {
  url: string;
  alt?: string;
  position: number;
}

export interface ProductSpecification {
  name: string;
  value: string;
}

export interface Product {
  id: number | string;
  article: string;
  name: string;
  slug: string;
  url: string;
  category?: Category;
  brand?: string;
  description?: string;
  images: ProductImage[];
  mainImage?: string;
  price?: number;
  oldPrice?: number;
  currency?: string;
  barcode?: string;
  inStock: boolean;
  stockQuantity?: string;
  specifications: ProductSpecification[];
  tags: string[];
  isNew: boolean;
  isSale: boolean;
  isHit: boolean;
  parsedAt: string;
  sourceUrl: string;
}

export interface ScraperConfig {
  baseUrl: string;
  outputDir: string;
  delayBetweenRequests: number;
  maxRetries: number;
  saveImages: boolean;
  imageDir?: string;
  jsonPrettyPrint: boolean;
  splitByCategory: boolean;
  categories?: string[];
}

export interface ParsingSummary {
  totalProducts: number;
  totalCategories: number;
  parsedAt: string;
  duration: string;
  categories: {
    name: string;
    productCount: number;
  }[];
  tags: {
    name: string;
    count: number;
  }[];
}