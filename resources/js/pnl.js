function pnl(){

    // INIT

    const isMobile = /Mobi/.test(navigator.userAgent);
    const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);

    var backerX = 0;

    var current_page = "app";
    $('img').attr('draggable', false);

    // GET DATA

    function api_read(){
        let data = localStorage.getItem("api");

        if(data === null || data == ""){
            api_save({
                "API": "noData",
                "SECRET": "noData"
            });
            
            return {
                "API": "noData",
                "SECRET": "noData"
            };;
        }else{ 
            data = JSON.parse(data);
            return data;
        };
    };

    function api_save(data){
        localStorage.setItem("api", JSON.stringify(data));
        return;
    };
    
    // UTILITY

    const BINANCE_BASE_URL = "https://api.binance.com";

    // ---------------------------------------------------------------------
    // 2) Utility: SubtleCrypto-based HMAC-SHA256 signing
    // ---------------------------------------------------------------------
    async function signRequest(queryString, secret) {
      const encoder = new TextEncoder();
      const secretKeyData = encoder.encode(secret);
      const messageData = encoder.encode(queryString);

      const key = await crypto.subtle.importKey(
        "raw",
        secretKeyData,
        { name: "HMAC", hash: { name: "SHA-256" } },
        false,
        ["sign"]
      );

      const signatureBuffer = await crypto.subtle.sign("HMAC", key, messageData);
      const signatureBytes = new Uint8Array(signatureBuffer);
      return Array.from(signatureBytes)
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
    }

    // ---------------------------------------------------------------------
    // 3) GET /api/v3/account to get balances
    // ---------------------------------------------------------------------
    async function getAccountInfo() {
      const timestamp = Date.now();
      const queryString = `timestamp=${timestamp}`;
      const signature = await signRequest(queryString, API['SECRET']);
      const finalQuery = `${queryString}&signature=${signature}`;

      const url = `${BINANCE_BASE_URL}/api/v3/account?${finalQuery}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-MBX-APIKEY': API['API']
        }
      });

      if (!response.ok) {
        throw new Error(`Error in getAccountInfo: ${response.statusText}`);
      }
      return response.json();
    }

    // ---------------------------------------------------------------------
    // 4) GET /api/v3/myTrades?symbol=SYMBOL to get trade history
    //    We'll replicate the Python logic to compute average purchase price:
    //      - Sort trades by time
    //      - For each buy, add (qty * price) to cost; add qty to position
    //      - For each sell, remove position at average cost
    // ---------------------------------------------------------------------
    async function getTrades(symbol) {
      const timestamp = Date.now();
      const queryString = `symbol=${symbol}&timestamp=${timestamp}`;
      const signature = await signRequest(queryString, API['SECRET']);
      const finalQuery = `${queryString}&signature=${await signature}`;

      const url = `${BINANCE_BASE_URL}/api/v3/myTrades?${finalQuery}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-MBX-APIKEY': API['API']
        }
      });

      if (!response.ok) {
        // If no trades or error, just return empty array
        return [];
      }
      return response.json();
    }

    // ---------------------------------------------------------------------
    // 5) GET /api/v3/ticker/price?symbol=SYMBOL for current price
    // ---------------------------------------------------------------------
    async function getSymbolTicker(symbol) {
      const url = `${BINANCE_BASE_URL}/api/v3/ticker/price?symbol=${symbol}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Error fetching ticker for ${symbol}: ${response.statusText}`);
      }
      return response.json();
    }

    // ---------------------------------------------------------------------
    // 6) Helper: compute average buy price from trade list
    //    This matches your Python "calculer_prix_achat_moyen" function.
    // ---------------------------------------------------------------------
    function computeAveragePrice(trades) {
      // Sort by time ascending
      trades.sort((a, b) => a.time - b.time);

      let positionQty = 0.0;
      let positionCost = 0.0;

      for (const t of trades) {
        const qty = parseFloat(t.qty);
        const price = parseFloat(t.price);

        if (t.isBuyer) {
          // Buy
          positionQty += qty;
          positionCost += qty * price;
        } else {
          // Sell
          if (positionQty <= 0) continue;
          const avgCost = positionCost / positionQty;
          const sellQty = qty;
          positionCost -= sellQty * avgCost;
          positionQty -= sellQty;
        }
      }

      if (positionQty > 0) {
        return positionCost / positionQty;
      }
      return null;
    }

    // ---------------------------------------------------------------------
    // 7) Main function to replicate your Python "afficher_actifs" logic:
    //    - Get account balances
    //    - For each asset > 0, get trades, average cost, ticker, etc.
    //    - Build a final JSON structure
    // ---------------------------------------------------------------------
    async function fetchBinanceData() {
      const result = {
        global: {
          bank: 0.0,
          pnl: 0.0
        },
        coins: []
      };

      let totalBalanceCurrent = 0.0;
      let totalPnl = 0.0;

      // 7.1 Get account info (balances)
      const accountInfo = await getAccountInfo();

      // 7.2 Iterate over each balance
      for (const balance of accountInfo.balances) {
        const asset = balance.asset;
        const free = parseFloat(balance.free);
        const locked = parseFloat(balance.locked);
        const total = free + locked;

        // Only consider assets with a meaningful quantity
        if (total <= 0) {
          continue;
        }

        // If the asset is "USDC", treat it as stable
        if (asset.toUpperCase() === 'USDC') {
          // Skip if less than 1 USDC
          if (total < 1) {
            continue;
          }
          // For USDC itself, we do not need trades or ticker
          // It's always "1.0", so PnL = 0 for stable
          const currentValue = total;   // total USDC
          totalBalanceCurrent += currentValue;

          // Add to result
          result.coins.push({
            asset: 'USDC',
            amount: total.toString(),
            price: "1.00",
            actual_value: currentValue.toString(),
            buy_value: currentValue.toString(),
            mean_buy: "1.00",
            ongoing_pnl: "0"
          });
          continue;
        }

        // 7.3 For other assets, build symbol => e.g. BTCUSDC
        const symbol = asset + "USDC";

        // 7.4 Get trades for that symbol
        let trades;
        try {
          trades = await getTrades(symbol);
        } catch (e) {
          // if there's an error or no trades
          continue;
        }

        // 7.5 Compute average cost from trades
        const avgPrice = computeAveragePrice(trades);

        // 7.6 Get current ticker price
        let currentPrice;
        try {
          const tickerData = await getSymbolTicker(symbol);
          currentPrice = parseFloat(tickerData.price);
        } catch (e) {
          currentPrice = null;
        }

        let currentValue = 0.0;
        if (currentPrice !== null) {
          currentValue = total * currentPrice;
        }

        let purchaseValue = 0.0;
        let pnl = 0.0;

        if (avgPrice !== null) {
          purchaseValue = total * avgPrice;
          pnl = currentValue - purchaseValue;
        } else {
          // No historical trades => treat cost = current if price is known
          purchaseValue = currentPrice ? (total * currentPrice) : 0;
          pnl = 0;
        }

        // skip if < 1 USDC in value
        const checkValue = currentPrice ? currentValue : purchaseValue;
        if (checkValue < 1) {
          continue;
        }

        totalBalanceCurrent += currentValue;
        totalPnl += pnl;

        // 7.7 Add details to "coins" array
        result.coins.push({
          asset: asset,
          amount: total.toString(),
          price: currentPrice ? currentPrice.toFixed(2) : "non disponible",
          actual_value: currentValue.toFixed(2),
          buy_value: purchaseValue.toFixed(2),
          mean_buy: avgPrice ? avgPrice.toFixed(2) : "indispo",
          ongoing_pnl: pnl >= 0 ? `+${pnl.toFixed(2)}` : pnl.toFixed(2)
        });
      }

      // 7.8 Populate global info
      result.global.bank = totalBalanceCurrent.toFixed(2);
      result.global.pnl = (totalPnl >= 0 ? `+${totalPnl.toFixed(2)}` : totalPnl.toFixed(2));

      // Return the final JSON structure
      return result;
    }

    //--------
    
    function getUserData(){
        let walletData = {
          "global": {
              "bank": 2500,
              "pnl": "+150"
          },
          "coins": [
              {
                  "asset": "BTC",
                  "amount": "0.0025",
                  "price": "60000",
                  "actual_value": "150",
                  "buy_value": "140",
                  "mean_buy": "56000",
                  "ongoing_pnl": "10"
              },
              {
                  "asset": "ETH",
                  "amount": "0.05",
                  "price": "4000",
                  "actual_value": "200",
                  "buy_value": "190",
                  "mean_buy": "3800",
                  "ongoing_pnl": "10"
              },
              {
                  "asset": "ADA",
                  "amount": "1500",
                  "price": "1.20",
                  "actual_value": "1800",
                  "buy_value": "2000",
                  "mean_buy": "1.33",
                  "ongoing_pnl": "-200"
              },
              {
                  "asset": "DOT",
                  "amount": "30",
                  "price": "35",
                  "actual_value": "1050",
                  "buy_value": "900",
                  "mean_buy": "30",
                  "ongoing_pnl": "150"
              },
              {
                  "asset": "SOL",
                  "amount": "5",
                  "price": "150",
                  "actual_value": "750",
                  "buy_value": "800",
                  "mean_buy": "160",
                  "ongoing_pnl": "-50"
              }
          ]
        }

        displayNewData(walletData);
        return walletData;
    };

    function displayNewData(walletData){
        // add filter logic

        $('.detail_elem_wrapper').children().remove();

        updateGlobalElements(walletData.global.bank, walletData.global.pnl);
        walletData.coins.forEach(function(coin) {
            generateAndPushTile(coin.asset, coin.amount, coin.price, coin.actual_value, coin.buy_value, coin.mean_buy, coin.ongoing_pnl);
        });
    }

    function updateGlobalElements(bank, pnl) {
        const pnlColor = pnl > 0 ? 'var(--green)' : pnl < 0 ? 'var(--red)' : 'var(--gray)';
        $('.global_elem.bank .elem_data').html(bank + ' <span class="currency">USDC</span>');
        $('.global_elem.pnl .elem_data').html(pnl + ' <span class="currency">USDC</span>');

        $('.pnl_data').css('color', pnlColor)
    };

    function generateAndPushTile(asset, amount, price, actual_value, buy_value, mean_buy, ongoing_pnl) {
        // Convert the PnL to a number
        const pnlNumber = parseFloat(ongoing_pnl);
    
        // Determine the sign and color based on the PnL value
        const sign = pnlNumber >= 0 ? '+' : '-';
        const formattedPnl = sign + Math.abs(pnlNumber);
        const pnlColor = pnlNumber > 0 ? 'var(--green)' : pnlNumber < 0 ? 'var(--red)' : 'var(--gray)';
    
        // Build the HTML using a template literal
        const tileHtml = `
            <div class="detail_elem">
                <div class="detail_elem_header">
                    <span class="detail_elem_title">
                        ${asset}
                        <span class="detail_elem_amount">${amount}</span>
                    </span>
                    <span class="detail_elem_price">${price}</span>
                </div>
                <div class="detail_elem_body">
                    <div class="detail_subElem">
                        <span class="detail_subElem_title">ACTUAL VALUE</span>
                        <span class="detail_subElem_data">${actual_value}</span>
                    </div>
                    <div class="detail_subElem">
                        <span class="detail_subElem_title">MEAN BUY</span>
                        <span class="detail_subElem_data">${mean_buy}</span>
                    </div>
                    <div class="detail_subElem">
                        <span class="detail_subElem_title">BUY VALUE</span>
                        <span class="detail_subElem_data">${buy_value}</span>
                    </div>
                    <div class="detail_subElem">
                        <span class="detail_subElem_title">ONGOIN PNL</span>
                        <span class="detail_subElem_data pnl_data" style="color: ${pnlColor};">${formattedPnl}</span>
                    </div>
                </div>
            </div>
        `;
    
        // Append the generated tile to the container with class ".detail_elem_wrapper"
        $('.detail_elem_wrapper').append(tileHtml);
    };
    
    function closeConnect(){
        $('#api_key-val').val(API['API']);
        $('#api_secret-val').val(API['SECRET']);
        $('.blurBG').css('display', 'none');
        current_page = 'app'
    };

    function refreshData(filter=false){
        if(filter){
            displayNewData(walletData)
        }else{
            walletData = getUserData();
        };
    };

    function goBack(){
        if(current_page == "app"){
            return
        }else if(current_page == "connect"){
            closeConnect();
        };
    };

    $(".IOSbacker").on("touchstart", function(e){
        e.preventDefault();
    }).on("touchmove", function(e){
        backerX = e.touches[0].clientX;
    }).on("touchend", function(){
        if(backerX > 50){
            goBack(platform);
        };
    });

    // NAVIGATION

    // EVENT HANDLERS

    $('.detail_select').on('change', function(){
        refreshData(true);
    });

    $('.refresh').on('click', function(){
        refreshData();
    });

    $('.profile_connect').on('click', function(){
        $('.blurBG').css('display', 'flex');
        current_page = 'connect'
    });

    $('.blurBG').on('click', function(e){
        if(!$(e.target).is(this)){return}
        closeConnect();
    });
    
    $('.connect_submit').on('click', function(e){
        let api = $('#api_key-val').val();
        let secret = $('#api_secret-val').val();

        if(api != "" && secret != ""){
            API["API"] = api;
            API["SECRET"] = secret
    
            api_save(API);
            
            closeConnect();
            refreshData();
        };
    });

    // GRAPHIC UPDATE

    document.oncontextmenu = function(){
        return false;
    };

    // INIT

    var walletData = false;
    var API = api_read();

    if(API['API'] != "noData"){
        $('#api_key-val').val(API['API']);
        $('#api_secret-val').val(API['SECRET']);

        refreshData();
    };
};

//RUN
$(document).ready(function(){pnl()})
