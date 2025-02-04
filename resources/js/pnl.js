function pnl(){

    // INIT

    const isMobile = /Mobi/.test(navigator.userAgent);
    const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);

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

    // Binance API base URL and a CORS proxy (for testing only)
    const BASE_URL = "https://api.binance.com";
    const CORS_PROXY = "https://cors-anywhere.herokuapp.com/";

    // --- Utility Functions ---
    function buildQueryString(params) {
      return Object.keys(params)
        .map(key => key + '=' + encodeURIComponent(params[key]))
        .join('&');
    }

    async function signRequest(queryString, secret) {
      const encoder = new TextEncoder();
      const keyData = encoder.encode(secret);
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(queryString));
      const signatureArray = Array.from(new Uint8Array(signatureBuffer));
      return signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // General function to call Binance API endpoints
    async function fetchBinance(endpoint, params = {}, signed = false) {
      if (signed) {
        // Add a timestamp and sign the query
        params.timestamp = Date.now();
        const qs = buildQueryString(params);
        const signature = await signRequest(qs, API['SECRET']);
        params.signature = signature;
      }
      const query = buildQueryString(params);
      const url = CORS_PROXY + BASE_URL + endpoint + (query ? '?' + query : '');
      const headers = signed ? { "X-MBX-APIKEY": API['API'] } : {};
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    }

    // --- Binance API Functions ---
    async function getAccountInfo() {
      return await fetchBinance('/api/v3/account', {}, true);
    }

    async function getMyTrades(symbol) {
      return await fetchBinance('/api/v3/myTrades', { symbol: symbol }, true);
    }

    async function getTickerPrice(symbol) {
      return await fetchBinance('/api/v3/ticker/price', { symbol: symbol }, false);
    }

    async function calculerPrixAchatMoyen(asset) {
      const symbol = asset + "USDC";
      let trades;
      try {
        trades = await getMyTrades(symbol);
      } catch (e) {
        console.error(`Error fetching trades for ${symbol}:`, e);
        return null;
      }
      // Sort trades chronologically
      trades.sort((a, b) => a.time - b.time);
      let positionQty = 0.0;
      let positionCost = 0.0;
      for (const trade of trades) {
        const qty = parseFloat(trade.qty);
        const price = parseFloat(trade.price);
        if (trade.isBuyer) {
          positionQty += qty;
          positionCost += qty * price;
        } else {
          if (positionQty <= 0) continue;
          const avgCost = positionCost / positionQty;
          positionCost -= qty * avgCost;
          positionQty -= qty;
        }
      }
      return positionQty > 0 ? positionCost / positionQty : null;
    }

    // --- Build Wallet Data ---
    async function getWalletData() {
      let accountInfo;
      try {
        accountInfo = await getAccountInfo();
      } catch (e) {
        console.error("Error fetching account info:", e);
        return;
      }
      let totalBalanceCurrent = 0.0;
      let totalPnl = 0.0;
      const coins = [];
      for (const balance of accountInfo.balances) {
        const asset = balance.asset;
        const free = parseFloat(balance.free);
        const locked = parseFloat(balance.locked);
        const total = free + locked;
        if (total <= 0) continue;
        // Special handling for USDC (treated as cash)
        if (asset.toUpperCase() === "USDC") {
          if (total < 1) continue;
          const avgPrice = 1.0;
          const currentPrice = 1.0;
          const purchaseValue = total * avgPrice;
          const currentValue = total * currentPrice;
          const pnl = currentValue - purchaseValue;
          totalBalanceCurrent += currentValue;
          totalPnl += pnl;
        } else {
          const symbol = asset + "USDC";
          const avgPrice = await calculerPrixAchatMoyen(asset);
          let currentPrice;
          try {
            const ticker = await getTickerPrice(symbol);
            currentPrice = parseFloat(ticker.price);
          } catch (e) {
            console.error(`Error fetching ticker for ${symbol}:`, e);
            currentPrice = null;
          }
          const currentValue = currentPrice !== null ? total * currentPrice : 0;
          let purchaseValue, pnl;
          if (avgPrice !== null) {
            purchaseValue = total * avgPrice;
            pnl = currentValue - purchaseValue;
          } else {
            purchaseValue = currentPrice !== null ? total * currentPrice : 0;
            pnl = 0;
          }
          const valueToCheck = currentPrice !== null ? currentValue : purchaseValue;
          if (valueToCheck < 1) continue;
          coins.push({
            asset: asset,
            amount: total.toString(),
            price: currentPrice !== null ? currentPrice.toString() : "non disponible",
            actual_value: currentValue.toString(),
            buy_value: purchaseValue.toString(),
            mean_buy: avgPrice !== null ? avgPrice.toString() : "non disponible",
            ongoing_pnl: pnl.toString()
          });
          totalBalanceCurrent += currentValue;
          totalPnl += pnl;
        }
      }
      const global = {
        bank: totalBalanceCurrent.toFixed(2),
        pnl: (totalPnl >= 0 ? "+" : "") + totalPnl.toFixed(2)
      };
      return { global, coins };
    }

    //--------
    
    function getUserData(){
        let walletData = getWalletData();

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
        $('.global_elem.bank .elem_data').html(bank + ' <span class="currency">USDC</span>');
        $('.global_elem.pnl .elem_data').html(pnl + ' <span class="currency">USDC</span>');
    };

    function generateAndPushTile(asset, amount, price, actual_value, buy_value, mean_buy, ongoing_pnl) {
        // Convert the PnL to a number
        const pnlNumber = parseFloat(ongoing_pnl);
    
        // Determine the sign and color based on the PnL value
        const sign = pnlNumber >= 0 ? '+' : '-';
        const formattedPnl = sign + Math.abs(pnlNumber);
        const pnlColor = pnlNumber >= 0 ? 'var(--green)' : 'var(--red)';
    
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