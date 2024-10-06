const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const bodyParser = require('body-parser');
const NodeCache = require('node-cache');
const dotenv = require('dotenv');
const crypto = require('crypto');
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3031;
const cache = new NodeCache({ stdTTL: 43200 }); // Cache time-to-live of 12 hours

app.use(express.static('public'));
app.use(cors());
app.use(bodyParser.json());

// Define your API keys
const apiKeys = {
    telugu: process.env.TELUGU,
    telugutwo: process.env.TELUGUTWO,
    english: process.env.ENGLISH,
    search: process.env.SEARCH,
};
const country = "in";

const englishlatestapi = process.env.TheNewsAPI;

// Counters for tracking requests
let apiRequestCount = 0;
let originalApiRequestCounts = {
    telugu: 0,
    english: 0,
    search: 0,
};

// Rate limiting configuration
const rateLimitWindow = 15 * 60 * 1000; // 15 minutes in milliseconds
const rateLimit = 30; // 30 requests per 15 minutes
let rateLimitResetTime = Date.now() + rateLimitWindow;
let firstRequestTime = null;

// Function to reset rate limit counters
function resetRateLimit() {
    apiRequestCount = 0;
    originalApiRequestCounts = {
        telugu: 0,
        english: 0,
        search: 0,
    };
    rateLimitResetTime = Date.now() + rateLimitWindow;
    firstRequestTime = null;
}

// Helper function to fetch news data
async function fetchNewsData(apiKey, language, query, category, nextPage) {
    try {
        const response = await axios.get(`https://newsdata.io/api/1/latest`, {
            params: {
                apikey: apiKey,
                language: language,
                q: query,
                category: category,
                page: nextPage,
                country: country,
                removeduplicate:1,
            },
        });
        return response.data;
    } catch (error) {
        throw new Error('Failed to fetch data');
    }
}

// Endpoint to get latest news in Telugu
app.get('/telugu/news', async (req, res) => {
    await handleNewsRequest(req, res, apiKeys.telugu, 'te', 'telugu');
});

app.get('/telugutwo/news', async (req, res) => {
    await handleNewsRequest(req, res, apiKeys.telugutwo, 'te', 'telugu');
});

// Endpoint to get latest news in English
app.get('/english/news', async (req, res) => {
    await handleNewsRequest(req, res, apiKeys.english, 'en', 'english');
});

// Endpoint to search news
app.get('/search', async (req, res) => {
    apiRequestCount++;

    const query = req.query.q; // Get the search query
    const language = req.query.language || 'te'; // Default to 'en' if no language is provided
    const category = req.query.category; // Get the category parameter if provided
    const nextPage = req.query.page; // Get the page parameter if provided
    const cacheKey = nextPage ? `search-${language}-${query}-${category}-page-${nextPage}` : `search-${language}-${query}-${category}`;
    let cachedData = cache.get(cacheKey);

    if (cachedData) {
        return res.json(encryptData(cachedData));
    }

    // Check if rate limit has been reached
    if (originalApiRequestCounts.search >= rateLimit) {
        const timeRemaining = rateLimitResetTime - Date.now();
        if (timeRemaining > 0) {
            return res.status(429).json({ error: 'Rate limit reached. Please try again later.' });
        } else {
            resetRateLimit();
        }
    }

    try {
        originalApiRequestCounts.search++;

        const data = await fetchNewsData(apiKeys.search, language, query, category, nextPage);
        cache.set(cacheKey, data); // Store data in cache
        return res.json(encryptData(data));
    } catch (error) {
        return res.status(500).json({ error: 'Failed to fetch data' });
    }
});

// Helper function to handle news requests
async function handleNewsRequest(req, res, apiKey, language, apiKeyType) {
    apiRequestCount++;

    const nextPage = req.query.page; // Get the page parameter if provided
    const cacheKey = nextPage ? `news-${language}-page-${nextPage}` : `news-${language}`;
    let cachedData = cache.get(cacheKey);

    if (cachedData) {
        return res.json(encryptData(cachedData));
    }

    // Check if rate limit has been reached
    if (originalApiRequestCounts[apiKeyType] >= rateLimit) {
        const timeRemaining = rateLimitResetTime - Date.now();
        if (timeRemaining > 0) {
            return res.status(429).json({ error: 'Rate limit reached. Please try again later.' });
        } else {
            resetRateLimit();
        }
    }

    try {
        originalApiRequestCounts[apiKeyType]++;

        const data = await fetchNewsData(apiKey, language, null, null, nextPage);
        cache.set(cacheKey, data); // Store data in cache
        return res.json(encryptData(data));
    } catch (error) {
        return res.status(500).json({ error: 'Failed to fetch data' });
    }
}

// Endpoint to get rate limit information
app.get('/rate-limit', (req, res) => {
    const timeElapsed = firstRequestTime ? Date.now() - firstRequestTime : 0;
    const timeRemaining = rateLimitWindow - timeElapsed;

    const rateLimitInfo = {
        Teluguapi: {
            teluguApiRequests: originalApiRequestCounts.telugu,
            OriginalApiRequestsRemaining: rateLimit - originalApiRequestCounts.telugu,
            TimeRemaining: timeRemaining / 1000, // Convert to seconds
        },
        Englishapi: {
            EnglishApiRequests: originalApiRequestCounts.english,
            OriginalApiRequestsRemaining: rateLimit - originalApiRequestCounts.english,
            TimeRemaining: timeRemaining / 1000, // Convert to seconds
        },
        SearchApi: {
            SearchApiRequests: originalApiRequestCounts.search,
            OriginalApiRequestsRemaining: rateLimit - originalApiRequestCounts.search,
            TimeRemaining: timeRemaining / 1000, // Convert to seconds
        },
    };

    res.json(rateLimitInfo);
});


// Function to scrape the content from the provided URL
async function scrapeContent(url) {
    try {
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);

        const title = $('.articleHD').text().trim();
        const image = $('.article-img img').attr('src');
        const content = $('.category_desc p').text().trim();

        return { title, image, content };
    } catch (error) {
        throw error;
    }
}

// Function to fetch and scrape the JSON data with a dynamic category ID
async function fetchAndScrapeData(categoryId = 1) {
    try {
        const response = await axios.get(`https://www.andhrajyothy.com/cms/articles/category/${categoryId}`);
        return response.data; // Assuming the response is JSON
    } catch (error) {
        throw error;
    }
}


// Function to fetch English news from the API and cache it
async function fetchEnglishNews() {
    const apiUrl = 'https://api.thenewsapi.com/v1/news/top';
    const apiToken = englishlatestapi
    const locale = 'in';
    const limit = 3;
    const pages = [1, 2, 3];

    try {
        const newsPromises = pages.map(async (page) => {
            const response = await axios.get(`${apiUrl}?api_token=${apiToken}&locale=${locale}&limit=${limit}&page=${page}`);
            return response.data.data;
        });

        const newsData = await Promise.all(newsPromises);
        const combinedNews = newsData.flat();
        cache.set('englishNews', combinedNews);
        return combinedNews;
    } catch (error) {
        throw error;
    }
}

// Route to serve the latest Telugu news with a dynamic category ID
app.get('/latestnewstelugu', async (req, res) => {
    const categoryId = req.query.categoryId || 1;
    try {
        const data = await fetchAndScrapeData(categoryId);
        res.json(encryptData(data));
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

// Route to serve the latest English news
app.get('/latestnewsenglish', async (req, res) => {
    try {
        let englishNews = cache.get('englishNews');
        if (!englishNews) {
            englishNews = await fetchEnglishNews();
        }
        res.json(encryptData(englishNews));
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch English news' });
    }
});



// Function to encrypt data using AES-256-CBC with a predefined secret key
function encryptData(data) {
    const algorithm = 'aes-256-cbc';
    const key = Buffer.from(process.env.SECRET_KEY, 'hex'); // Convert the secret key to a buffer
    const iv = crypto.randomBytes(16); // Generate a random IV

    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return {
        iv: iv.toString('hex'),
        encryptedData: encrypted,
    };
}

// Start the server
app.listen(PORT, () => {
});
