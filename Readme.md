### Извлекаемые данные

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | number | ID товара |
| `article` | string | Артикул |
| `name` | string | Название товара |
| `brand` | string | Производитель |
| `price` | number | Текущая цена (RUB) |
| `oldPrice` | number | Старая цена (если скидка) |
| `images` | array[] | Все изображения товара |
| `inStock` | boolean | Наличие на складе |
| `stockQuantity` | string | Количество на складе |
| `tags` | array[] | Теги (АКЦИЯ, НОВИНКА, ХИТ) |
| `category` | object | Полная информация о категории |
| `weight` | string | Вес товара |
| `parsedAt` | string | Дата парсинга (ISO 8601) |
| `sourceUrl` | string | Ссылка на товар |

### Стек

- **Node.js** + **TypeScript** — основной язык
- **Puppeteer** — headless Chrome для рендеринга JavaScript
- **Axios** — прямые HTTP-запросы к API (быстрее чем Puppeteer)
- **Cheerio** — парсинг HTML (если нужно)
- **JSON** — формат выходных данных

### Предварительные требования

- **Node.js** 18+ ([скачать](https://nodejs.org/))
- **npm** или **yarn**

### Установка

```bash
# Клонировать репозиторий
git clone https://github.com/zanegin-n/scrapper.git
cd scraper

# Перейти в нужный проект
cd petshop-scraper

# Установить зависимости
npm install

# Собрать TypeScript
npm run build

# Запустить парсер
npm start

# Парсер petshop.ru
cd petshop-scraper && npm start

# Парсер aquanimal.ru
cd ../aquanimal-scraper && npm start

# Парсер gstriol.ru
cd ../gstriol-scraper && npm start

# Парсер westernpets.ru
cd ../westernpets-scraper && npm start

# Парсер zooman.ru
cd ../zooman-scraper && npm start
