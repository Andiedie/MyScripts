// ==UserScript==
// @name         SSD转种查询工具
// @namespace    http://tampermonkey.net/
// @version      0.7.3
// @author       andie
// @updateURL    https://github.com/Andiedie/MyScripts/raw/refs/heads/main/ssd_cross_seed_query.user.js
// @downloadURL  https://github.com/Andiedie/MyScripts/raw/refs/heads/main/ssd_cross_seed_query.user.js
// @homepageURL  https://github.com/Andiedie/MyScripts
// @match        https://springsunday.net/userdetails.php*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @require      https://cdn.bootcdn.net/ajax/libs/jquery/3.7.1/jquery.min.js
// ==/UserScript==

(function() {
    'use strict';

    // 辅助：格式化文件大小
    function formatSize(bytes) {
        bytes = Number(bytes);
        if (typeof bytes !== "number" || isNaN(bytes)) return bytes;
        if (bytes < 1024) return bytes + " B";
        const mib = bytes / (1024 * 1024);
        if (mib < 1024) return mib.toFixed(2) + " MiB";
        const gib = mib / 1024;
        if (gib < 1024) return gib.toFixed(2) + " GiB";
        const tib = gib / 1024;
        return tib.toFixed(2) + " TiB";
    }

    // 注入样式
    GM_addStyle(`
        #startQueryButton {
            position: fixed;
            left: 10px;
            top: 50%;
            transform: translateY(-50%);
            z-index: 9999;
            padding: 8px 12px;
            background: #1d4ed8;
            color: #fff;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
        #queryModal {
            display: none;
            position: fixed;
            top: 0; left: 0;
            width: 100vw; height: 100vh;
            background: rgba(0,0,0,0.5);
            z-index: 10000;
            overflow-y: auto;
        }
        #modalContent {
            background: #fff;
            margin: 50px auto;
            padding: 20px;
            max-width: 800px;
            max-height: calc(100vh - 100px);
            overflow-y: auto;
            position: relative;
            border-radius: 4px;
        }
        #closeModal {
            position: absolute;
            top: 10px;
            right: 10px;
            cursor: pointer;
        }
        #configForm label {
            display: block;
            margin: 6px 0;
        }
        #configForm input {
            width: 100%;
            box-sizing: border-box;
            padding: 4px;
        }
        #resultTable {
            width: 100%;
            border-collapse: collapse;
        }
        #resultTable th, #resultTable td {
            border: 1px solid #ccc;
            padding: 6px;
            text-align: left;
        }
        #logArea {
            max-height: 10em;
            overflow-y: auto;
            background: #f8f8f8;
            border: 1px solid #ccc;
            margin-top: 10px;
            padding: 5px;
            font-size: 12px;
        }
    `);

    // 在页面左侧固定添加“开始查询转种”按钮
    $('body').append('<button id="startQueryButton">开始查询转种</button>');

    // 弹窗 HTML 模板，配置区按顺序调整并增加新项，操作区增加站点选项
    const modalHtml = `
    <div id="queryModal">
      <div id="modalContent">
        <button id="closeModal">关闭</button>
        <h2>转种查询工具</h2>
        <div id="configArea">
            <button id="toggleConfig">配置区 (点击展开/折叠)</button>
            <div id="configForm" style="display:none; margin-top:10px;">
                <label>MTEAM API KEY: <input type="text" id="mteamApiKey" /></label>
                <label>TMDB API KEY: <input type="text" id="tmdbApiKey" /></label>
                <label>TMDB READ ACCESS TOKEN: <input type="text" id="tmdbReadAccessToken" /></label>
                <label>目标结果数量: <input type="number" id="targetCount" value="10" /></label>
                <label>馒头限流 (秒): <input type="number" id="mteamRateLimit" value="5" /></label>
                <label>TMDB API 限流 (秒): <input type="number" id="tmdbRateLimit" value="1" /></label>
                <label>SSD 限流 (秒): <input type="number" id="ssdRateLimit" value="5" /></label>
                <label>杜比 Cookie: <input type="text" id="dolbyCookie" /></label>
                <label>杜比 API 限流 (秒): <input type="number" id="dolbyRateLimit" value="5" /></label>
                <label>标题/副标题排除关键词 (逗号隔开): <input type="text" id="titleExclusionKeywords" /></label>
                <label>标题后缀排除 (逗号隔开): <input type="text" id="titleExclusionSuffixes" /></label>
                <button id="saveConfig">保存配置</button>
                <button id="resetExclusionSettings">重置排除设置</button>
                <button id="clearQueryIDs">清空已查询链接ID</button>
            </div>
        </div>
        <hr/>
        <div id="functionArea">
            <div style="margin-bottom:8px;">
              <button id="startStopButton">开始</button>
              <select id="queryOption">
                <option value="1">电影 1080p BDRip H.264 DTS/FLAC/AC3/AAC 中字</option>
                <option value="2">电影 2160p BDRip H.265 中字</option>
                <option value="3">电影 2160p WEB-DL 国外 中字</option>
                <option value="4">剧集 2160p WEB-DL 国外 中字 合集</option>
              </select>
              <label>站点选项:
                <select id="siteOption">
                  <option value="mteam">馒头</option>
                  <option value="dolby">杜比</option>
                </select>
              </label>
            </div>
            <div id="extraExclusionDisplay" style="margin-bottom:8px; background:#f0f0f0; padding: 5px;">
              <div>当前选项额外排除关键词：<span id="extraExclusionKeywordsDisplay"></span></div>
              <div>当前选项额外排除后缀：<span id="extraExclusionSuffixesDisplay"></span></div>
            </div>
            <div id="progressContainer" style="margin-top:10px;">
                <progress id="progressBar" value="0" max="100" style="width:100%;"></progress>
                <span id="progressText"></span>
            </div>
            <div id="logArea"></div>
            <div id="resultTableContainer" style="margin-top:20px;">
                <table id="resultTable">
                    <thead>
                        <tr>
                            <th>标题</th>
                            <th>链接</th>
                            <th>大小</th>
                            <th>做种人数</th>
                            <th>时间</th>
                            <th>SSD链接</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
            </div>
        </div>
      </div>
    </div>`;
    $('body').append(modalHtml);

    // 系统默认配置更新（新增 TMDB 与杜比相关配置）
    const defaultConfig = {
        mteamApiKey: "",
        tmdbApiKey: "",
        tmdbReadAccessToken: "",
        targetCount: 10,
        mteamRateLimit: 5,
        tmdbRateLimit: 1,
        ssdRateLimit: 5,
        dolbyCookie: "",
        dolbyRateLimit: 5,
        titleExclusionKeywords: "webrip,remux",
        titleExclusionSuffixes: "-FGT,-NSBC,-BATWEB,-GPTHD,-DreamHD,-BlackTV,-CatWEB,-Xiaomi,-Huawei,-MOMOWEB,-DDHDTV,-SeeWeb,-TagWeb,-SonyHD,-MiniHD,-BitsTV,-CTRLHD,-ALT,-NukeHD,-ZeroTV,-HotTV,-EntTV,-GameHD,-SmY,-SeeHD,-VeryPSP,-DWR,-XLMV,-XJCTV,-Mp4Ba,-GodDramas,-toothless,-YTS.MX,-FRDS,@FRDS,-BeiTai,-YingWEB,VCB-Studio"
    };
    let config = GM_getValue("config", defaultConfig);
    // 初始化配置表单
    $('#mteamApiKey').val(config.mteamApiKey);
    $('#tmdbApiKey').val(config.tmdbApiKey);
    $('#tmdbReadAccessToken').val(config.tmdbReadAccessToken);
    $('#targetCount').val(config.targetCount);
    $('#mteamRateLimit').val(config.mteamRateLimit);
    $('#tmdbRateLimit').val(config.tmdbRateLimit);
    $('#ssdRateLimit').val(config.ssdRateLimit);
    $('#dolbyCookie').val(config.dolbyCookie);
    $('#dolbyRateLimit').val(config.dolbyRateLimit);
    $('#titleExclusionKeywords').val(config.titleExclusionKeywords);
    $('#titleExclusionSuffixes').val(config.titleExclusionSuffixes);

    // 记录查询过的链接ID（包括豆瓣、IMDB、TMDB）
    let collectedQueryIDs = GM_getValue("collectedQueryIDs", []);

    // 配置保存
    $('#saveConfig').click(function() {
        config = {
            mteamApiKey: $('#mteamApiKey').val(),
            tmdbApiKey: $('#tmdbApiKey').val(),
            tmdbReadAccessToken: $('#tmdbReadAccessToken').val(),
            targetCount: parseInt($('#targetCount').val()),
            mteamRateLimit: parseInt($('#mteamRateLimit').val()),
            tmdbRateLimit: parseInt($('#tmdbRateLimit').val()),
            ssdRateLimit: parseInt($('#ssdRateLimit').val()),
            dolbyCookie: $('#dolbyCookie').val(),
            dolbyRateLimit: parseInt($('#dolbyRateLimit').val()),
            titleExclusionKeywords: $('#titleExclusionKeywords').val(),
            titleExclusionSuffixes: $('#titleExclusionSuffixes').val()
        };
        GM_setValue("config", config);
        alert("配置已保存");
    });
    // 重置排除设置
    $('#resetExclusionSettings').click(function() {
        if (confirm("确定要重置排除设置吗？")) {
            $('#titleExclusionKeywords').val(defaultConfig.titleExclusionKeywords);
            $('#titleExclusionSuffixes').val(defaultConfig.titleExclusionSuffixes);
            config.titleExclusionKeywords = defaultConfig.titleExclusionKeywords;
            config.titleExclusionSuffixes = defaultConfig.titleExclusionSuffixes;
            GM_setValue("config", config);
            alert("排除设置已重置为默认值");
        }
    });
    // 清空已查询链接ID
    $('#clearQueryIDs').click(function() {
        collectedQueryIDs = [];
        GM_setValue("collectedQueryIDs", collectedQueryIDs);
        alert("已清空查询记录的链接ID");
    });
    // 配置区折叠/展开
    $('#toggleConfig').click(function() {
        $('#configForm').toggle();
    });
    // 关闭弹窗
    $('#closeModal').click(function() {
        $('#queryModal').hide();
    });
    // 点击左侧按钮显示弹窗
    $('#startQueryButton').click(function() {
        $('#queryModal').show();
    });

    // 更新额外排除显示（只读展示当前选项额外排除关键词和后缀）
    function updateExtraExclusionDisplay() {
        let currentOption = getCurrentQueryOption();
        let extraKeywords = currentOption.extraExclusionKeywords || [];
        let extraSuffixes = currentOption.extraExclusionSuffixes || [];
        $('#extraExclusionKeywordsDisplay').text(extraKeywords.join(","));
        $('#extraExclusionSuffixesDisplay').text(extraSuffixes.join(","));
    }
    $('#queryOption').change(updateExtraExclusionDisplay);

    // 定义促销类型选项及对应参数（用于馒头查询）——与原逻辑一致
    const queryOptions = {
        "1": {
            label: "电影 1080p BDRip H.264 DTS/FLAC/AC3/AAC 中字",
            mteamPayload: {
                "mode": "normal",
                "categories": ["401", "419"],
                "videoCodecs": ["1"],
                "audioCodecs": ["1", "3", "6", "8"],
                "standards": ["1"],
                "labels": 4,
                "visible": 1,
                "keyword": "blu",
                "sortDirection": "DESC",
                "sortField": "SEEDERS",
                "pageNumber": 1,
                "pageSize": 100
            },
            ssdTemplate: "cat501=1&medium6=1&standard2=1&codec2=1&internal=&selfrelease=&animation=&exclusive=&pack=&untouched=&selfpurchase=&mandarin=&subtitlezh=1&subtitlesp=&selfcompile=&dovi=&hdr10=&hdr10plus=&hdrvivid=&hlg=&cc=&3d=&request=&contest=&incldead=0&spstate=0&pick=0&inclbookmarked=0&my=&search={douban}&search_area=5&search_mode=0",
            extraExclusionKeywords: ["合集"],
            extraExclusionSuffixes: ["-HDH", "-HDS", "-Eleph", "-Dream", "-UBits"]
        },
        "2": {
            label: "电影 2160p BDRip H.265 中字",
            mteamPayload: {
                "mode": "normal",
                "categories": ["401", "419"],
                "videoCodecs": ["16"],
                "standards": ["6"],
                "labels": 4,
                "visible": 1,
                "keyword": "blu",
                "sortDirection": "DESC",
                "sortField": "SEEDERS",
                "pageNumber": 1,
                "pageSize": 100
            },
            ssdTemplate: "cat501=1&medium6=1&standard1=1&codec1=1&internal=&selfrelease=&animation=&exclusive=&pack=&untouched=&selfpurchase=&mandarin=&subtitlezh=1&subtitlesp=&selfcompile=&dovi=&hdr10=&hdr10plus=&hdrvivid=&hlg=&cc=&3d=&request=&contest=&incldead=0&spstate=0&pick=0&inclbookmarked=0&my=&search={douban}&search_area=5&search_mode=0",
            extraExclusionKeywords: ["合集"],
            extraExclusionSuffixes: ["-HDH", "-HDS", "-Eleph", "-Dream", "-UBits"]
        },
        "3": {
            label: "电影 2160p WEB-DL 国外 中字",
            mteamPayload: {
                "mode": "normal",
                "categories": ["401", "419"],
                "standards": ["6"],
                "labels": 4,
                "visible": 1,
                "keyword": "web",
                "sortDirection": "DESC",
                "sortField": "SEEDERS",
                "pageNumber": 1,
                "pageSize": 100
            },
            ssdTemplate: "cat501=1&medium7=1&standard1=1&internal=&selfrelease=&animation=&exclusive=&pack=&untouched=&selfpurchase=&mandarin=&subtitlezh=1&subtitlesp=&selfcompile=&dovi=&hdr10=&hdr10plus=&hdrvivid=&hlg=&cc=&3d=&request=&contest=&incldead=0&spstate=0&pick=0&inclbookmarked=0&my=&search={douban}&search_area=5&search_mode=0",
            extraExclusionKeywords: ["合集"],
            extraExclusionSuffixes: ["-HDH", "-HDS"],
            additionalFilters: ["countries"]
        },
        "4": {
            label: "剧集 2160p WEB-DL 国外 中字 合集",
            mteamPayload: {
                "mode": "normal",
                "categories": ["401", "419"],
                "standards": ["6"],
                "labels": 4,
                "visible": 1,
                "keyword": "web",
                "sortDirection": "DESC",
                "sortField": "SEEDERS",
                "pageNumber": 1,
                "pageSize": 100
            },
            ssdTemplate: "cat502=1&cat503=1&cat505=1&medium7=1&standard1=1&internal=&selfrelease=&animation=&exclusive=&pack=1&untouched=&selfpurchase=&mandarin=&subtitlezh=1&subtitlesp=&selfcompile=&dovi=&hdr10=&hdr10plus=&hdrvivid=&hlg=&cc=&3d=&request=&contest=&incldead=0&spstate=0&pick=0&inclbookmarked=0&my=&search=%7Bdouban%7D&search_area=5&search_mode=0",
            extraExclusionKeywords: [],
            extraExclusionSuffixes: ["-HDH", "-HDS"],
            additionalFilters: ["countries", "multiSeason"]
        }
    };

    // 定义杜比站点 URL 模板（其中 {page} 用于翻页替换，从 0 开始）
    const dolbyUrls = {
        "1": "https://www.hddolby.com/torrents.php?cat401=1&medium10=1&codec1=1&audiocodec4=1&audiocodec5=1&audiocodec6=1&audiocodec7=1&standard2=1&incldead=1&spstate=0&inclbookmarked=0&search=&search_area=0&search_mode=0&tags=zz&sort=7&type=desc&page={page}",
        "2": "https://www.hddolby.com/torrents.php?cat401=1&medium10=1&codec2=1&standard1=1&incldead=1&spstate=0&inclbookmarked=0&search=&search_area=0&search_mode=0&tags=zz&sort=7&type=desc&page={page}",
        "3": "https://www.hddolby.com/torrents.php?cat401=1&medium6=1&standard1=1&incldead=1&spstate=&inclbookmarked=&search=&search_area=&search_mode=&tags=zz&sort=7&type=desc&page={page}",
        "4": "https://www.hddolby.com/torrents.php?cat402=1&cat404=1&cat403=1&medium6=1&standard1=1&incldead=1&spstate=&inclbookmarked=&search=&search_area=&search_mode=&tags=wj,zz&sort=7&type=desc&page={page}"
    };

    // 获取当前促销类型选项对象（用于过滤配置及模板参数）
    function getCurrentQueryOption() {
        const opt = $('#queryOption').val();
        return queryOptions[opt];
    }
    updateExtraExclusionDisplay();

    // 状态变量
    let running = false;
    let currentPage = ($('#siteOption').val() === "mteam") ? 1 : 0; // 馒头从1开始，杜比从0开始
    let results = [];

    // 更新进度条
    function updateProgress() {
        const percent = Math.min((results.length / config.targetCount) * 100, 100);
        $('#progressBar').val(percent);
        $('#progressText').text(`${results.length} / ${config.targetCount}`);
    }

    // 通用限流包装器：保证连续调用间隔 delaySeconds 秒
    function createRateLimitedFunction(fn, delaySeconds) {
        let lastCallTime = 0;
        return async function(...args) {
            const now = Date.now();
            const waitTime = delaySeconds * 1000 - (now - lastCallTime);
            if (waitTime > 0) {
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
            lastCallTime = Date.now();
            return await fn(...args);
        };
    }

    // MTeam 查询接口（保持原有逻辑）
    async function queryMTeam(pageNumber, payload) {
        let reqPayload = Object.assign({}, payload, { pageNumber: pageNumber });
        try {
            const response = await fetch("https://api.m-team.io/api/torrent/search", {
                method: "POST",
                headers: {
                    "x-api-key": config.mteamApiKey,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(reqPayload)
            });
            if (response.ok) {
                const data = await response.json();
                if (data.code === "0") {
                    return data.data.data;
                } else {
                    console.error("馒头 API 错误:", data.message);
                    appendLog("馒头 API 错误: " + data.message);
                    return [];
                }
            } else {
                console.error("馒头 API HTTP 错误:", response.status);
                appendLog("馒头 API HTTP 错误: " + response.status);
                return [];
            }
        } catch (e) {
            console.error("请求异常:", e);
            appendLog("请求异常: " + e);
            return [];
        }
    }

    // SSD 查询接口（保持原有逻辑，支持豆瓣/imdb）
    async function querySSD(queryLink, ssdTemplate, linkType) {
        let effectiveTemplate = ssdTemplate;
        if (linkType === "imdb") {
            effectiveTemplate = effectiveTemplate.replace("search_area=5", "search_area=4");
        }
        const ssdUrl = "https://springsunday.net/torrents.php?" + effectiveTemplate.replace("{douban}", encodeURIComponent(queryLink));
        try {
            const response = await fetch(ssdUrl, { credentials: "include" });
            if (response.ok) {
                const html = await response.text();
                if (html.includes("没有种子。请用准确的关键字重试。")) {
                    return false; // 不重复
                } else {
                    return true;  // 已重复
                }
            } else {
                console.error("SSD API HTTP 错误:", response.status);
                appendLog("SSD API HTTP 错误: " + response.status);
                return true;
            }
        } catch (e) {
            console.error("SSD 请求异常:", e);
            appendLog("SSD 请求异常: " + e);
            return true;
        }
    }

    // 杜比查询接口：使用 GM_xmlhttpRequest，传入配置的 Cookie，并返回 HTML 字符串
    async function queryDolby(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                headers: {
                    "Cookie": config.dolbyCookie
                },
                onload: function(response) {
                    if (response.status === 200) {
                        resolve(response.responseText);
                    } else {
                        appendLog("杜比 API HTTP 错误: " + response.status);
                        resolve("");
                    }
                },
                onerror: function(err) {
                    appendLog("杜比 请求异常: " + err);
                    resolve("");
                }
            });
        });
    }

    // 解析杜比返回的 HTML，提取表格中的种子信息
    function parseDolbyHTML(html) {
        let torrents = [];
        let temp = $('<div>').html(html);
        // 找到非表头的行（示例中种子行通常带有 class "sticky_normal"）
        temp.find('.torrents tr').slice(1).each(function() {
            let $tr = $(this);
            // 尝试从内部的 <a> 提取标题与详情链接
            let aTag = $tr.find('a[href*="details.php"]').first();
            if (!aTag.length) return;
            let name = aTag.text().trim();
            let detailLink = aTag.attr('href');
            if (detailLink && detailLink.indexOf("http") !== 0) {
                detailLink = "https://www.hddolby.com/" + detailLink;
            }
            // 提取其他信息：种子大小、做种人数、发布时间（各自在不同 td 中）
            let tds = $tr.children('td');
            let size = tds.eq(4).text().trim();
            let seeders = tds.eq(5).text().trim();
            let time = tds.eq(3).find('span').attr('title') || tds.eq(2).text().trim();
            // 仅处理带有 TMDB 链接的情况（杜比种子不包含豆瓣或IMDB链接）
            let tmdbLink = null;
            $tr.find('a').each(function() {
                let href = $(this).attr('href');
                if (href && href.indexOf("themoviedb.org") !== -1) {
                    tmdbLink = href;
                }
            });
            appendLog('11111');
            let crossSeedForbidden = !!$tr.find('.tags.tjz').length;
            appendLog('22222');
            torrents.push({
                name: name,
                detailLink: detailLink,
                size: size,
                seeders: seeders,
                time: time,
                tmdb: tmdbLink,
                crossSeedForbidden: crossSeedForbidden,
            });
        });
        return torrents;
    }

    // 从 TMDB 链接中提取 tmdbId 和媒体类型（movie 或 tv）
    function extractTMDBInfo(tmdbLink) {
        let result = { tmdbId: null, mediaType: null };
        if (!tmdbLink) return result;
        if (tmdbLink.indexOf("/movie/") !== -1) {
            result.mediaType = "movie";
            let m = tmdbLink.match(/\/movie\/(\d+)(?:-|$)/);
            if (m) result.tmdbId = m[1];
        } else if (tmdbLink.indexOf("/tv/") !== -1) {
            result.mediaType = "tv";
            let m = tmdbLink.match(/\/tv\/(\d+)(?:-|\/|$)/);
            if (m) result.tmdbId = m[1];
        }
        return result;
    }

    // 查询 TMDB 详细信息（检查 origin_country）
    async function queryTMDBDetails(tmdbId, mediaType) {
        let url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?language=en-US`;
        try {
            const response = await fetch(url, {
                headers: {
                    "Authorization": "Bearer " + config.tmdbReadAccessToken,
                    "accept": "application/json"
                }
            });
            if (response.ok) {
                return await response.json();
            } else {
                console.error("TMDB 详情 HTTP 错误:", response.status);
                return null;
            }
        } catch (e) {
            console.error("TMDB 详情 请求异常:", e);
            return null;
        }
    }

    // 查询 TMDB external_ids，将 tmdbId 转换为 imdb_id
    async function queryTMDBExternalIDs(tmdbId, mediaType) {
        let url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/external_ids?api_key=${config.tmdbApiKey}`;
        try {
            const response = await fetch(url, {
                headers: {
                    "accept": "application/json"
                }
            });
            if (response.ok) {
                return await response.json();
            } else {
                console.error("TMDB external_ids HTTP 错误:", response.status);
                return null;
            }
        } catch (e) {
            console.error("TMDB external_ids 请求异常:", e);
            return null;
        }
    }

    // 构造 SSD 链接（与原有逻辑一致）
    function buildSSDLink(queryLink, linkType, ssdTemplate) {
        let effectiveTemplate = ssdTemplate;
        if (linkType === "imdb") {
            effectiveTemplate = effectiveTemplate.replace("search_area=5", "search_area=4");
        }
        return "https://springsunday.net/torrents.php?" + effectiveTemplate.replace("{douban}", encodeURIComponent(queryLink));
    }

    // 主流程：根据站点选项分别执行
    async function startProcess() {
        running = true;
        currentPage = ($('#siteOption').val() === "mteam") ? 1 : 0;
        results = [];
        $('#resultTable tbody').empty();
        $('#logArea').empty();
        updateProgress();
        appendLog("开始查询转种...");

        const currentOption = getCurrentQueryOption();
        let defaultKeywords = config.titleExclusionKeywords.split(",").map(s => s.trim().toLowerCase()).filter(s => s);
        let extraOptionKeywords = currentOption.extraExclusionKeywords || [];
        let combinedKeywords = defaultKeywords.concat(extraOptionKeywords);
        let defaultSuffixes = config.titleExclusionSuffixes.split(",").map(s => s.trim()).filter(s => s);
        let extraOptionSuffixes = currentOption.extraExclusionSuffixes || [];
        let combinedSuffixes = defaultSuffixes.concat(extraOptionSuffixes);

        const siteOption = $('#siteOption').val();
        if (siteOption === "mteam") {
            const rateLimitedQueryMTeam = createRateLimitedFunction(queryMTeam, config.mteamRateLimit);
            const rateLimitedQuerySSD = createRateLimitedFunction(querySSD, config.ssdRateLimit);
            while (running && results.length < config.targetCount) {
                const torrents = await rateLimitedQueryMTeam(currentPage, currentOption.mteamPayload);
                if (!torrents || torrents.length === 0) {
                    appendLog(`第 ${currentPage} 页未返回种子，终止处理。`);
                    break;
                }
                for (let torrent of torrents) {
                    if (!running || results.length >= config.targetCount) break;
                    const name = torrent.name || "";
                    const descr = torrent.smallDescr || "";
                    let skip = false;
                    for (let word of combinedKeywords) {
                        if (word && (name.toLowerCase().includes(word) || descr.toLowerCase().includes(word))) {
                            appendLog(`种子 "${name}" 跳过：包含排除关键词 "${word}"`);
                            skip = true;
                            break;
                        }
                    }
                    if (skip) continue;
                    for (let suffix of combinedSuffixes) {
                        if (suffix && name.endsWith(suffix)) {
                            appendLog(`种子 "${name}" 跳过：标题以排除后缀 "${suffix}"`);
                            skip = true;
                            break;
                        }
                    }
                    if (skip) continue;
                    if (/\d{4}-\d{4}/.test(name)) {
                        appendLog(`种子 "${name}" 跳过：匹配多年份`);
                        continue;
                    }
                    let queryLink, linkType, queryID;
                    if (torrent.douban) {
                        queryLink = torrent.douban;
                        linkType = "douban";
                        const m = torrent.douban.match(/subject\/(\d+)/);
                        if (m) {
                            queryID = m[1];
                        } else {
                            appendLog(`种子 "${name}" 跳过：豆瓣链接格式错误 ${torrent.douban}`);
                            continue;
                        }
                    } else if (torrent.imdb) {
                        queryLink = torrent.imdb;
                        linkType = "imdb";
                        const m = torrent.imdb.match(/title\/(tt\d+)/);
                        if (m) {
                            queryID = m[1];
                        } else {
                            appendLog(`种子 "${name}" 跳过：IMDB链接格式错误 ${torrent.imdb}`);
                            continue;
                        }
                    } else {
                        appendLog(`种子 "${name}" 跳过：无豆瓣或IMDB链接`);
                        continue;
                    }
                    if (collectedQueryIDs.includes(queryID)) {
                        appendLog(`种子 "${name}" 跳过：链接ID ${queryID} 已检查过`);
                        continue;
                    }
                    collectedQueryIDs.push(queryID);
                    GM_setValue("collectedQueryIDs", collectedQueryIDs);
                    appendLog(`查询 SSD 判断种子 "${name}" 是否重复...`);
                    const isDupe = await rateLimitedQuerySSD(queryLink, currentOption.ssdTemplate, linkType);
                    if (!isDupe) {
                        let createdDateStr = torrent.createdDate || "";
                        let datePart = createdDateStr ? createdDateStr.substring(0, 10) : "";
                        results.push({
                            title: name,
                            link: `https://kp.m-team.cc/detail/${torrent.id}`,
                            size: formatSize(torrent.size),
                            seeders: torrent.status ? torrent.status.seeders : "",
                            time: createdDateStr,
                            ssdLink: buildSSDLink(queryLink, linkType, currentOption.ssdTemplate)
                        });
                        $('#resultTable tbody').append(
                            `<tr>
                                <td>${name}</td>
                                <td><a href="https://kp.m-team.cc/detail/${torrent.id}" target="_blank">链接</a></td>
                                <td>${formatSize(torrent.size)}</td>
                                <td>${torrent.status ? torrent.status.seeders : ""}</td>
                                <td>${datePart}</td>
                                <td><a href="${buildSSDLink(queryLink, linkType, currentOption.ssdTemplate)}" target="_blank">SSD链接</a></td>
                            </tr>`
                        );
                        appendLog(`种子 "${name}" 加入结果。`);
                        updateProgress();
                    } else {
                        appendLog(`种子 "${name}" 检测到重复，跳过。`);
                    }
                }
                currentPage++;
            }
        } else if (siteOption === "dolby") {
            const rateLimitedQueryDolby = createRateLimitedFunction(queryDolby, config.dolbyRateLimit);
            const rateLimitedQuerySSD = createRateLimitedFunction(querySSD, config.ssdRateLimit);
            const rateLimitedQueryTMDBDetails = createRateLimitedFunction(queryTMDBDetails, config.tmdbRateLimit);
            const rateLimitedQueryTMDBExternal = createRateLimitedFunction(queryTMDBExternalIDs, config.tmdbRateLimit);
            while (running && results.length < config.targetCount) {
                let urlTemplate = dolbyUrls[$('#queryOption').val()];
                let url = urlTemplate.replace("{page}", currentPage);
                let html = await rateLimitedQueryDolby(url);
                if (!html) {
                    appendLog(`第 ${currentPage} 页未返回种子，终止处理。`);
                    break;
                }
                let torrents = parseDolbyHTML(html);
                if (!torrents || torrents.length === 0) {
                    appendLog(`第 ${currentPage} 页未返回种子，终止处理。`);
                    break;
                }
                appendLog(`共解析出 ${torrents.length} 个种子`)
                for (let torrent of torrents) {
                    if (!running || results.length >= config.targetCount) break;
                    const name = torrent.name || "";
                    if (torrent.crossSeedForbidden) {
                        appendLog(`种子 "${name}" 禁转`);
                        continue
                    }
                    let skip = false;
                    for (let word of combinedKeywords) {
                        if (word && name.toLowerCase().includes(word)) {
                            appendLog(`种子 "${name}" 跳过：包含排除关键词 "${word}"`);
                            skip = true;
                            break;
                        }
                    }
                    if (skip) continue;
                    for (let suffix of combinedSuffixes) {
                        if (suffix && name.endsWith(suffix)) {
                            appendLog(`种子 "${name}" 跳过：标题以排除后缀 "${suffix}"`);
                            skip = true;
                            break;
                        }
                    }
                    if (skip) continue;
                    // 杜比种子仅处理带有 TMDB 链接的情况
                    if (torrent.tmdb) {
                        let { tmdbId, mediaType } = extractTMDBInfo(torrent.tmdb);
                        if (!tmdbId) {
                            appendLog(`种子 "${name}" 跳过：无法解析 TMDB 链接 ${torrent.tmdb}`);
                            continue;
                        }
                        if (collectedQueryIDs.includes(tmdbId)) {
                            appendLog(`种子 "${name}" 跳过：TMDB id ${tmdbId} 已检查过`);
                            continue;
                        }
                        let tmdbDetails = await rateLimitedQueryTMDBDetails(tmdbId, mediaType);
                        if (!tmdbDetails) {
                            appendLog(`种子 "${name}" 跳过：TMDB 查询失败`);
                            continue;
                        }
                        // 如果国家包含 CN 或 HK，则立刻加入查询记录并跳过该种子
                        if (tmdbDetails.origin_country && Array.isArray(tmdbDetails.origin_country)) {
                            if (tmdbDetails.origin_country.includes("CN") || tmdbDetails.origin_country.includes("HK")) {
                                appendLog(`种子 "${name}" 跳过：制作地区包含 CN 或 HK`);
                                collectedQueryIDs.push(tmdbId);
                                GM_setValue("collectedQueryIDs", collectedQueryIDs);
                                continue;
                            }
                        }
                        collectedQueryIDs.push(tmdbId);
                        GM_setValue("collectedQueryIDs", collectedQueryIDs);
                        // 转换 TMDB id 为 imdb id
                        let externalIDs = await rateLimitedQueryTMDBExternal(tmdbId, mediaType);
                        if (!externalIDs || !externalIDs.imdb_id) {
                            appendLog(`种子 "${name}" 跳过：未获取到 imdb_id`);
                            continue;
                        }
                        let queryLink = "https://www.imdb.com/title/" + externalIDs.imdb_id;
                        appendLog(`查询 SSD 判断种子 "${name}" 是否重复...`);
                        let isDupe = await rateLimitedQuerySSD(queryLink, currentOption.ssdTemplate, "imdb");
                        if (!isDupe) {
                            results.push({
                                title: name,
                                link: torrent.detailLink,
                                size: torrent.size,
                                seeders: torrent.seeders,
                                time: torrent.time,
                                ssdLink: buildSSDLink(queryLink, "imdb", currentOption.ssdTemplate)
                            });
                            $('#resultTable tbody').append(
                                `<tr>
                                    <td>${name}</td>
                                    <td><a href="${torrent.detailLink}" target="_blank">链接</a></td>
                                    <td>${torrent.size}</td>
                                    <td>${torrent.seeders}</td>
                                    <td>${torrent.time}</td>
                                    <td><a href="${buildSSDLink(queryLink, "imdb", currentOption.ssdTemplate)}" target="_blank">SSD链接</a></td>
                                </tr>`
                            );
                            appendLog(`种子 "${name}" 加入结果。`);
                            updateProgress();
                        } else {
                            appendLog(`种子 "${name}" 检测到重复，跳过。`);
                        }
                    } else {
                        appendLog(`种子 "${name}" 跳过：杜比种子缺少 TMDB 链接`);
                        continue;
                    }
                }
                currentPage++;
            }
        }
        running = false;
        $('#startStopButton').text("开始");
        appendLog(`查询结束，收集到 ${results.length} 个种子。`);
    }

    // 日志追加函数
    function appendLog(message) {
        const timestamp = new Date().toLocaleTimeString();
        $('#logArea').append(`<div>[${timestamp}] ${message}</div>`);
        $('#logArea').scrollTop($('#logArea')[0].scrollHeight);
    }

    // 开始/停止按钮事件
    $('#startStopButton').click(function() {
        if (!running) {
            $(this).text("停止");
            startProcess();
        } else {
            running = false;
            $(this).text("开始");
            appendLog("用户停止查询。");
        }
    });
})();
