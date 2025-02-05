function pnl(){

    // INIT

    const isMobile = /Mobi/.test(navigator.userAgent);
    const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);

    const DRAG_THRESHOLD = 15;
    const MAX_PULL = 30;

    let isBacking = false;
    var backerY = 0;
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
            };
        }else{ 
            data = JSON.parse(data);
            return data;
        };
    };

    function api_save(data){
        localStorage.setItem("api", JSON.stringify(data));
        return;
    };

    function filter_read(){
      let data = localStorage.getItem("filter");

        if(data === null || data == ""){
          $("#sortingVar").val("Name");
          $("#sortingWay").val("Asc");

          return {
              "var": "Name",
              "way": "Asc"
          };
        }else{ 
          data = JSON.parse(data);

          $("#sortingVar").val(data['var']);
          $("#sortingWay").val(data['way']);
        };
    }

    function filter_save(data){
      localStorage.setItem("filter", JSON.stringify(data));
      return;
    };
    
    // UTILITY

    // -------------------------------
    // 1) Minimal HMAC-SHA256 in Browser
    // -------------------------------
    async function signHmacSha256(queryString, secret) {
      // Using SubtleCrypto
      const encoder = new TextEncoder();
      const keyData = encoder.encode(secret);
      const msgData = encoder.encode(queryString);

      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );

      const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
      const signatureBytes = new Uint8Array(signatureBuffer);
      const signatureHex = Array.from(signatureBytes)
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
      return signatureHex;
    }

    // -------------------------------
    // 2) Proxy call
    //    We'll post { apiKey, endpoint, queryString }
    //    The server returns the Binance JSON
    // -------------------------------
    async function callBinanceProxy(apiKey, endpoint, queryString) {
      const payload = {
        apiKey: apiKey,
        endpoint: endpoint,
        queryString: queryString
      };

      const response = await fetch("https://betterpnlgetdata-production.up.railway.app:8080/proxySigned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error("Proxy error: " + response.status);
      }
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }
      return data;
    }

    // -------------------------------
    // 3) Get Account Info
    // -------------------------------
    async function getAccountInfo(apiKey, apiSecret) {
      const timestamp = Date.now();
      let queryString = `timestamp=${timestamp}`;
      const signature = await signHmacSha256(queryString, apiSecret);
      queryString += `&signature=${signature}`;
      return callBinanceProxy(apiKey, "/api/v3/account", queryString);
    }

    // -------------------------------
    // 4) Get Trades for a Symbol
    // -------------------------------
    async function getMyTrades(apiKey, apiSecret, symbol) {
      const timestamp = Date.now();
      let queryString = `symbol=${symbol}&timestamp=${timestamp}`;
      const signature = await signHmacSha256(queryString, apiSecret);
      queryString += `&signature=${signature}`;
      return callBinanceProxy(apiKey, "/api/v3/myTrades", queryString);
    }

    // -------------------------------
    // 5) Get Ticker (public endpoint)
    //    You can either call the same proxy (no signature needed),
    //    or directly fetch from Binance if CORS is allowed.
    // -------------------------------
    async function getSymbolPrice(symbol) {
      // Let's try direct fetch (public endpoint).
      // If CORS blocks it, do the same "proxy" approach
      const url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error(`Error fetching ticker for ${symbol}: ${resp.status}`);
      }
      return resp.json();
    }

    // -------------------------------
    // 6) Compute Average Purchase Price
    //    Mirroring your Python function "calculer_prix_achat_moyen"
    // -------------------------------
    function computeAveragePrice(trades) {
      // Sort by time ascending
      trades.sort((a, b) => a.time - b.time);

      let positionQty = 0.0;
      let positionCost = 0.0;

      for (const t of trades) {
        const qty = parseFloat(t.qty);
        const price = parseFloat(t.price);
        if (t.isBuyer) {
          positionQty += qty;
          positionCost += qty * price;
        } else {
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

    // -------------------------------
    // 7) Main Logic: replicate afficher_actifs() in JS
    //    We'll produce final JSON { global: {...}, coins: [...] }
    // -------------------------------
    async function fetchAndComputePortfolio(apiKey, apiSecret) {
      const result = {
        global: { bank: 0, pnl: 0 },
        coins: []
      };

      // 7.1 Get account info (which is now an array of balances)
      const accountArray = await getAccountInfo(apiKey, apiSecret);
      let totalBalanceCurrent = 0;
      let totalPnl = 0;

      // Loop through each balance entry
      for (const balance of accountArray.balances) {
        const asset = balance.asset;
        const free = parseFloat(balance.free);
        const locked = parseFloat(balance.locked);
        const quantity = free + locked;

        // Skip if zero total
        if (quantity <= 0) continue;

        // Special case: USDC
        if (asset.toUpperCase() === "USDC") {
          // skip if < 1
          if (quantity < 1) {
            continue;
          }
          // Value of USDC is exactly the quantity
          const currentValue = quantity;
          const purchaseValue = currentValue;
          const pnl = 0;
          totalBalanceCurrent += currentValue;
          totalPnl += pnl;

          result.coins.push({
            asset: "USDC",
            amount: quantity.toString(),
            price: "1.00",
            actual_value: currentValue.toFixed(2),
            buy_value: purchaseValue.toFixed(2),
            mean_buy: "1.00",
            ongoing_pnl: pnl.toFixed(2)
          });
          continue;
        }

        // For other assets, we get trades + ticker
        const symbol = asset + "USDC";

        // 7.2 Get trades for that symbol (array)
        let trades = [];
        try {
          trades = await getMyTrades(apiKey, apiSecret, symbol);
        } catch (e) {
          // If there's an error (e.g., no trades, invalid symbol) => skip
          continue;
        }

        // 7.3 Compute average price from trades
        const avgPrice = computeAveragePrice(trades);

        // 7.4 get current price (public endpoint)
        let currentPrice = null;
        let currentValue = 0;

        try {
          const tickerData = await getSymbolPrice(symbol); // e.g. { symbol: "SOLUSDC", price: "231.40" }
          currentPrice = parseFloat(tickerData.price);
          currentValue = quantity * currentPrice;
        } catch (e) {
          // Ticker not found => skip or treat as 0
          currentPrice = null;
        }

        // 7.5 Compute purchaseValue & PnL
        let purchaseValue = 0;
        let pnl = 0;

        if (avgPrice !== null) {
          purchaseValue = quantity * avgPrice;
          pnl = currentValue - purchaseValue;
        } else {
          // If no average cost, assume purchase = current
          purchaseValue = currentValue;
          pnl = 0;
        }

        // skip if < 1 USDC in value
        if (currentValue < 1 && purchaseValue < 1) {
          continue;
        }

        // Tally up totals
        totalBalanceCurrent += currentValue;
        totalPnl += pnl;

        // Add to the final "coins" array
        result.coins.push({
          asset: asset,
          amount: quantity.toString(),
          price: currentPrice ? currentPrice.toFixed(2) : "N/A",
          actual_value: currentValue.toFixed(2),
          buy_value: purchaseValue.toFixed(2),
          mean_buy: avgPrice ? avgPrice.toFixed(2) : "N/A",
          ongoing_pnl: pnl >= 0 ? `+${pnl.toFixed(2)}` : pnl.toFixed(2)
        });
      }

      // 7.6 Final global stats
      result.global.bank = totalBalanceCurrent.toFixed(2);
      result.global.pnl = totalPnl >= 0 ? `+${totalPnl.toFixed(2)}` : totalPnl.toFixed(2);

      return result;
    }

    //--------
    
    async function getUserData(){
        let walletData = await fetchAndComputePortfolio(API['API'], API['SECRET']);
        return walletData;
    };

    function displayNewData(walletData){
      $('.detail_elem_wrapper').children().remove();

      if(API['API'] == "noData" || walletData == false){return};

      updateGlobalElements(walletData.global.bank, walletData.global.pnl);
      filterWalletData(walletData).coins.forEach(function(coin) {
        if(coin.asset != 'USDC'){
          generateAndPushTile(coin.asset, coin.amount, coin.price, coin.actual_value, coin.buy_value, coin.mean_buy, coin.ongoing_pnl);
        };
      });
    }

    function updateGlobalElements(bank, pnl) {
        const pnlColor = pnl > 0 ? 'var(--green)' : pnl < 0 ? 'var(--red)' : 'var(--gray)';
        $('.global_elem.bank .elem_data').html(bank + ' <span class="currency">$</span>');
        $('.global_elem.pnl .elem_data').html(pnl + ' <span class="currency">$</span>');

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
                    <span class="detail_elem_price">${price} $</span>
                </div>
                <div class="detail_elem_body">
                    <div class="detail_subElem">
                        <span class="detail_subElem_title">ACTUAL VALUE</span>
                        <span class="detail_subElem_data actual_value">${actual_value} $</span>
                    </div>
                    <div class="detail_subElem">
                        <span class="detail_subElem_title">MEAN BUY</span>
                        <span class="detail_subElem_data mean_buy">${mean_buy} $</span>
                    </div>
                    <div class="detail_subElem">
                        <span class="detail_subElem_title">BUY VALUE</span>
                        <span class="detail_subElem_data buy_value">${buy_value} $</span>
                    </div>
                    <div class="detail_subElem">
                        <span class="detail_subElem_title">ONGOIN PNL</span>
                        <span class="detail_subElem_data pnl_data" style="color: ${pnlColor};">${formattedPnl} $</span>
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

    function filterWalletData(data) {
      const mode = $("#sortingVar").val();  // "Name" | "PNL" | "Amount" (example)
      const way = $("#sortingWay").val();   // "ASC" | "DESC"
      
      data.coins.sort((a, b) => {
        switch (mode) {
          case "Name": {
            // Sort by asset name (string comparison)
            return a.asset.localeCompare(b.asset);
          }
          case "PNL": {
            // ongoing_pnl might be "+10" or "10" or "-50", so parseFloat is safe
            const pnlA = parseFloat(a.ongoing_pnl);
            const pnlB = parseFloat(b.ongoing_pnl);
            return pnlA - pnlB;
          }
          case "Amount": {
            const amtA = parseFloat(a.amount);
            const amtB = parseFloat(b.amount);
            return amtA - amtB;
          }
          default:
            return 0;
        }
      });
    
      // If the user wants descending order, just reverse
      if (way === "Desc") {
        data.coins.reverse();
      }
    
      return data; 
    };

    async function refreshData(filter=false){
      if(filter){
          displayNewData(walletData)
      }else{
          $('.detail_subElem_data:not(.mean_buy, .buy_value), .detail_elem_price, .elem_data').text('');
          $('.detail_subElem_data:not(.mean_buy, .buy_value), .detail_elem_price, .elem_data').addClass('skeleton');

          walletData = await getUserData();
          displayNewData(walletData);
      };

      $('.skeleton').removeClass('skeleton');
    };

    function goBack(){
        if(current_page == "app"){
            return
        }else if(current_page == "connect"){
            closeConnect();
        };
    };

    function backerMousedownHandler(e){
      if(current_page == "selection" && !add_state && !timeInputShown && !rotation_state && !statOpened && !calendarState && !isExtraOut){return};
      
      const clientX = (e.type === "mousedown")
      ? e.clientX
      : e.originalEvent.touches[0].clientX;
      
      const clientY = (e.type === "mousedown")
      ? e.pageY
      : e.originalEvent.touches[0].clientY;
  
      backerY = clientY;
  
      if(clientX < DRAG_THRESHOLD){
          isBacking = true;
  
          $("#IOSbackerUI").css({
              transition: "none",
              "-webkit-transition": "none"
          });
      };
    };
    
    function backerMousemoveHandler(e){
        if (!isBacking) return;
        
        const pointerX = (e.type === "mousemove")
        ? e.pageX
        : e.originalEvent.touches[0].pageX;
    
        backerX = pointerX;
    
        const windowH = $(window).innerHeight();
    
        const upperBound = Math.max(0, backerY - Math.round(windowH * 0.30)); 
        const lowerBound = Math.min(windowH, backerY + Math.round(windowH * 0.30)); 
        
        const highCurveHandleX = Math.min(pointerX, MAX_PULL);
        const highCurveHandleY = backerY;
        const lowCurveHandleX = Math.min(pointerX, MAX_PULL);
        const lowCurveHandleY = backerY;
    
        const pathData = `M 0 ${upperBound} C ${highCurveHandleX} ${highCurveHandleY} ${lowCurveHandleX} ${lowCurveHandleY} 0 ${lowerBound}`;
    
        $("#IOSbackerUI").css({
            "clip-path": `path("${pathData}")`,
            "-webkit-clip-path": `path("${pathData}")`
        });
    };
    
    function backerMouseupHandler(){
        if (!isBacking) return;
        isBacking = false;
        
        $("#IOSbackerUI").css({
            transition: "clip-path 0.3s ease, -webkit-clip-path 0.3s ease",
            "-webkit-transition": "clip-path 0.3s ease, -webkit-clip-path 0.3s ease",
        });
    
        const windowH = $(window).innerHeight();
    
        const upperBound = Math.max(0, backerY - Math.round(windowH * 0.40)); 
        const lowerBound = Math.min(windowH, backerY + Math.round(windowH * 0.40)); 
    
        const pathData = `M 0 ${upperBound} C 0 ${backerY} 0 ${backerY} 0 ${lowerBound}`;
    
        $("#IOSbackerUI").css({
            "clip-path": `path("${pathData}")`,
            "-webkit-clip-path": `path("${pathData}")`
        });
    
        if(backerX >= MAX_PULL){
            const event = new CustomEvent('backed', { bubbles: true });
            $('#IOSbackerUI')[0].dispatchEvent(event);
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

    if(isMobile){
        $('#IOSbackerUI').css('display', "block");

        $(document).on("mousedown", backerMousedownHandler);
        $(document).on("mousemove", backerMousemoveHandler);
        $(document).on("mouseup", backerMouseupHandler);

        $('#IOSbackerUI').on('backed', function(){
            goBack();
        });
    }else{
        $('#IOSbackerUI').remove();
    };

    $('.detail_select').on('change', function(){
        filter_save({
          "var": $("#sortingVar").val(),
          "way": $("#sortingWay").val()
        })

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
    filter_read();

    if(API['API'] != "noData"){
        $('#api_key-val').val(API['API']);
        $('#api_secret-val').val(API['SECRET']);

        refreshData();
    };
};

//RUN
$(document).ready(function(){pnl()})
