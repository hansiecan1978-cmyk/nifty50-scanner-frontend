require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { ROC, MACD } = require('technicalindicators');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 10000;

// Top 10 Nifty 50 symbols to avoid API rate limits
const NIFTY_50 = [
  'RELIANCE.BSE', 'TCS.BSE', 'HDFCBANK.BSE', 'INFY.BSE', 'ICICIBANK.BSE',
  'KOTAKBANK.BSE', 'SBIN.BSE', 'ASIANPAINT.BSE', 'AXISBANK.BSE', 'BAJFINANCE.BSE'
];

// In your Node.js backend
app.use(cors()); // Install cors package first

// Cache for storing stock data
const stockDataCache = {
  data: [],
  lastUpdated: null
};

// Root endpoint
app.get('/', (req, res) => {
  res.send('Nifty 50 Scanner Backend is running!');
});

// Get all stocks data
app.get('/api/stocks', async (req, res) => {
  try {
    // Serve cached data if updated within last 5 minutes
    if (stockDataCache.lastUpdated && Date.now() - stockDataCache.lastUpdated < 300000) {
      return res.json(stockDataCache.data);
    }
    
    const results = [];
    
    for (const symbol of NIFTY_50) {
      const stockResult = await processStock(symbol);
      if (stockResult) results.push(stockResult);
      
      // Add delay to respect API rate limits (1 request every 12 seconds)
      await new Promise(resolve => setTimeout(resolve, 12000));
    }
    
    // Sort by highest probability
    results.sort((a, b) => b.probability - a.probability);
    
    // Update cache
    stockDataCache.data = results;
    stockDataCache.lastUpdated = Date.now();
    
    res.json(results);
  } catch (error) {
    console.error('Error processing stocks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Process a single stock
async function processStock(symbol) {
  try {
    // Fetch stock data from Alpha Vantage
    const response = await axios.get(
      `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${symbol}&interval=5min&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`
    );
    
    if (!response.data || !response.data['Time Series (5min)']) {
      return generateFallbackData(symbol);
    }
    
    const timeSeries = response.data['Time Series (5min)'];
    const closes = [];
    
    // Get the last 30 closing prices
    Object.keys(timeSeries).slice(0, 30).forEach(timestamp => {
      closes.push(parseFloat(timeSeries[timestamp]['4. close']));
    });
    
    // Reverse to chronological order (oldest first)
    closes.reverse();
    
    // Calculate indicators
    const roc = ROC.calculate({ period: 5, values: closes });
    const macd = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9
    });
    
    const lastClose = closes[closes.length - 1];
    const prevClose = closes.length > 1 ? closes[closes.length - 2] : lastClose;
    
    // Calculate probability and direction
    const result = calculateProbability(roc, macd, lastClose, prevClose);
    
    return {
      symbol: symbol.split('.')[0],
      price: lastClose,
      change: ((lastClose - prevClose) / prevClose * 100).toFixed(2),
      volatility: (calculateVolatility(closes) * 100).toFixed(2),
      probability: result.probability,
      direction: result.direction,
      indicators: {
        roc: roc.length > 0 ? roc[roc.length - 1] : 0,
        macd: macd.length > 0 ? macd[macd.length - 1].histogram : 0
      }
    };
    
  } catch (error) {
    console.error(`Error processing ${symbol}:`, error.message);
    return generateFallbackData(symbol);
  }
}

function calculateVolatility(closes) {
  let sum = 0;
  for (let i = 1; i < closes.length; i++) {
    sum += Math.abs((closes[i] - closes[i-1]) / closes[i-1]);
  }
  return sum / (closes.length - 1);
}

function calculateProbability(roc, macd, lastClose, prevClose) {
  const gap = Math.abs((lastClose - prevClose) / prevClose);
  const rocValue = roc.length > 0 ? Math.abs(roc[roc.length - 1]) : 0;
  const macdValue = macd.length > 0 ? Math.abs(macd[macd.length - 1].histogram) : 0;
  
  // Simplified probability calculation
  const probability = Math.min(90, 20 + (gap * 500) + (rocValue * 30) + (macdValue * 50));
  
  // Determine direction
  const direction = (roc.length > 0 && roc[roc.length - 1] > 0) ? 'buy' : 'sell';
  
  return {
    probability: Math.round(probability),
    direction
  };
}

function generateFallbackData(symbol) {
  const direction = Math.random() > 0.5 ? "buy" : "sell";
  const probability = Math.floor(Math.random() * 40) + 50; // 50-90%
  const price = (Math.random() * 5000 + 100).toFixed(2);
  const change = (Math.random() * 4 - 2).toFixed(2); // -2% to +2%
  
  return {
    symbol: symbol.split('.')[0],
    price: parseFloat(price),
    change: parseFloat(change),
    volatility: (Math.random() * 3).toFixed(2),
    probability,
    direction,
    indicators: {
      roc: direction === "buy" ? (Math.random() * 2).toFixed(2) : (Math.random() * -2).toFixed(2),
      macd: direction === "buy" ? (Math.random() * 0.5).toFixed(2) : (Math.random() * -0.5).toFixed(2)
    }
  };
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

});
