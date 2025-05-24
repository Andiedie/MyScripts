// ==UserScript==
// @name         蛙蛙命名助手
// @namespace    http://tampermonkey.net/
// @version      1.6.0
// @description  根据原标题和MediaInfo，构建符合蛙蛙要求的种子主标题
// @author       andie
// @match        https://www.qingwapt.org/upload.php*
// @grant        none
// @downloadURL https://github.com/Andiedie/MyScripts/raw/refs/heads/main/wa_name_helper.user.js
// @updateURL https://github.com/Andiedie/MyScripts/raw/refs/heads/main/wa_name_helper.user.js
// ==/UserScript==

(function() {
    'use strict';

    // 常量定义
    const AUDIO_FORMATS = [
        { name: 'DTS-HD MA', regex: /\bDTS-HD MA\b/i },
        { name: 'DTS-HD', regex: /\bDTS-HD\b/i },
        { name: 'DTS-X', regex: /\bDTS-X\b/i },
        { name: 'TrueHD Atmos', regex: /\bTrueHD Atmos\b/i },
        { name: 'Atmos', regex: /\bAtmos\b/i },
        { name: 'TrueHD', regex: /\bTrueHD\b/i },
        { name: 'DTS', regex: /\bDTS\b/i },
        { name: 'DDP', regex: /\bDDP\d*\.?\d*\b/i },
        { name: 'DD+', regex: /\bDD\+\b/i },
        { name: 'AAC', regex: /\bAAC\b/i },
        { name: 'DD', regex: /\bDD\b/i },
        { name: 'AC3', regex: /\bAC3\b/i },
        { name: 'FLAC', regex: /\bFLAC\b/i },
        { name: 'LPCM', regex: /\bLPCM\b/i },
        { name: 'EAC3', regex: /\bEAC3\b/i }
    ];

    // 从地区码中移除CC
    const REGION_CODES = ['JPN', 'CHN', 'USA', 'KOR', 'FRA', 'GER', 'DEU', 'ITA', 'ESP', 'GBR', 'CAN', 'AUS', 'TWN', 'TW', 'HKG', 'NOR'];

    // 新增其他信息数组，扩展了额外标识
    const EXTRA_INFO = ['CC', 'Unrated', 'Extended', 'Uncut', 'Complete Edition', 'Remaster'];

    const VIDEO_SOURCES = ['BluRay', 'WEB-DL', 'WebRip', 'HDTV', 'DVDRip', 'BDRip', 'TVRip'];
    const VIDEO_ENCODINGS = ['x264', 'x265', 'HEVC', 'AVC', 'H264', 'H265'];
    const RESOLUTIONS = ['2160p', '1080p', '720p', '480p'];

    // 修改HDR格式常量，确保不会误判
    const HDR_FORMATS = [
        { name: 'DoVi HDR10+', regex: /\b(?<!no-|no )dolby\s*vision.*hdr10\+|dovi.*hdr10\+/i },
        { name: 'DoVi HDR', regex: /\b(?<!no-|no )dolby\s*vision.*hdr(?!\+)|dovi.*hdr(?!\+)/i },
        { name: 'DoVi', regex: /\b(?<!no-|no )dolby\s*vision|dovi/i },
        { name: 'HDR10+', regex: /\b(?<!no-|no )hdr10\+/i },
        { name: 'HDR', regex: /\b(?<!no-|no )(hdr\b(?!\+)|hdr10(?!\+)|smpte\s*st\s*2086)/i }
    ];

    // 已知制作组列表（优先匹配）
    const KNOWN_GROUP = ['MNHD-FRDS'];

    // 全局变量来跟踪按钮和提示
    let formatBtn = null;
    let toolCell = null;
    let errorMessage = null;

    // 初始化界面
    window.addEventListener('load', initUI);

    function initUI() {
        console.log('青蛙转种助手: 脚本已加载');

        const publishBtn = document.querySelector('input[type="submit"][value="发布"]');
        if (!publishBtn) return;

        console.log('青蛙转种助手: 找到发布按钮');

        // 获取表格
        const tableRows = document.querySelector('form > table > tbody').querySelectorAll('tr');
        const firstRow = tableRows[0];

        // 创建工具栏行
        const toolRow = document.createElement('tr');
        toolCell = document.createElement('td');
        toolCell.className = 'toolbox';
        toolCell.align = 'center';
        toolCell.colSpan = '2';

        // 创建规范标题按钮
        formatBtn = document.createElement('input');
        formatBtn.type = 'button';
        formatBtn.value = '重建标题';
        formatBtn.style.marginRight = '10px';
        formatBtn.addEventListener('click', standardizeTitle);

        // 移除发布按钮的原始父元素并重新添加
        publishBtn.parentNode.removeChild(publishBtn);

        // 添加元素到工具栏
        toolCell.appendChild(formatBtn);
        toolCell.appendChild(publishBtn);
        toolRow.appendChild(toolCell);

        // 添加工具栏到表格
        firstRow.parentNode.insertBefore(toolRow, firstRow);

        // 移除可能的重复工具栏
        const lastRow = tableRows[tableRows.length - 1];
        if (lastRow.querySelector('.toolbox') && lastRow !== toolRow) {
            lastRow.parentNode.removeChild(lastRow);
            console.log('青蛙转种助手: 删除了重复的工具栏');
        }

        // 添加MediaInfo文本框变化监听
        const mediaInfoTextarea = document.querySelector('textarea[name="technical_info"]');
        if (mediaInfoTextarea) {
            // 使用input事件来监听所有变化，包括粘贴、输入和删除
            mediaInfoTextarea.addEventListener('input', handleMediaInfoChange);
            console.log('青蛙转种助手: 已添加MediaInfo文本框变化监听');
        }

        console.log('青蛙转种助手: 界面初始化完成');

        // 修复：在页面加载完成后强制执行一次MediaInfo检查，确保按钮状态正确
        setTimeout(() => {
            console.log('青蛙转种助手: 执行初始MediaInfo状态检查');
            handleMediaInfoChange();
        }, 500);
    }

    // 创建错误提示元素
    function createErrorMessage() {
        if (errorMessage && errorMessage.parentNode) {
            errorMessage.parentNode.removeChild(errorMessage);
        }

        errorMessage = document.createElement('span');
        errorMessage.textContent = 'MediaInfo 解析失败';
        errorMessage.style.color = 'red';
        errorMessage.style.fontWeight = 'bold';
        errorMessage.style.marginRight = '10px';
        console.log('青蛙转种助手: 创建错误提示');
        return errorMessage;
    }

    // 移除错误提示
    function removeErrorMessage() {
        if (errorMessage && errorMessage.parentNode) {
            errorMessage.parentNode.removeChild(errorMessage);
            errorMessage = null;
            console.log('青蛙转种助手: 移除错误提示');
        }
    }

    // 处理MediaInfo文本框变化
    function handleMediaInfoChange() {
        console.log('青蛙转种助手: MediaInfo内容已变化，开始解析');

        // 获取当前MediaInfo内容
        const mediaInfoTextarea = document.querySelector('textarea[name="technical_info"]');
        if (!mediaInfoTextarea || !mediaInfoTextarea.value.trim()) {
            console.log('青蛙转种助手: MediaInfo为空');

            // MediaInfo为空时，移除错误提示，显示重建标题按钮
            removeErrorMessage();
            if (formatBtn) {
                formatBtn.style.display = '';
            }
            return;
        }

        // 尝试提取音频格式和声道数
        const audioFormat = extractAudioFormat();
        const audioChannels = extractAudioChannels();

        // 检查是否成功解析了MediaInfo
        if (audioFormat && audioChannels) {
            console.log('青蛙转种助手: MediaInfo解析成功，音频格式:', audioFormat, '声道数:', audioChannels);

            // 解析成功，移除错误提示，显示重建标题按钮
            removeErrorMessage();
            if (formatBtn) {
                formatBtn.style.display = '';
                console.log('青蛙转种助手: 显示重建标题按钮');
            }
        } else {
            console.log('青蛙转种助手: MediaInfo解析失败，无法获取音频格式或声道数');

            // 解析失败，显示错误提示，隐藏重建标题按钮
            if (!errorMessage) {
                errorMessage = createErrorMessage();
                if (toolCell) {
                    toolCell.insertBefore(errorMessage, formatBtn);
                    console.log('青蛙转种助手: 添加错误提示');
                }
            }

            // 隐藏重建标题按钮
            if (formatBtn) {
                formatBtn.style.display = 'none';
                console.log('青蛙转种助手: 隐藏重建标题按钮');
            }
        }
    }

    // ---------------- 新的标题提取和构建函数 ----------------

    // 从原始标题中提取电影/剧集名称（年份之前的部分）
    function extractTitle(originalTitle) {
        const yearMatch = originalTitle.match(/\b(19\d{2}|20\d{2})\b/);
        if (!yearMatch) {
            return originalTitle.trim();
        }

        const year = yearMatch[0];
        const yearIndex = originalTitle.indexOf(year);
        return originalTitle.substring(0, yearIndex).trim();
    }

    // 从原始标题中提取年份
    function extractYear(originalTitle) {
        const yearMatch = originalTitle.match(/\b(19\d{2}|20\d{2})\b/);
        return yearMatch ? yearMatch[0] : null;
    }

    // 从原始标题中提取分辨率
    function extractResolution(originalTitle) {
        for (const res of RESOLUTIONS) {
            const resRegex = new RegExp('\\b' + res + '\\b', 'i');
            if (resRegex.test(originalTitle)) {
                return res;
            }
        }
        return null;
    }

    // 从原始标题中提取地区码
    function extractRegionCode(originalTitle) {
        for (const code of REGION_CODES) {
            const codeRegex = new RegExp('\\b' + code + '\\b', 'i');
            if (codeRegex.test(originalTitle)) {
                return code;
            }
        }
        return null;
    }

    // 新增：从原始标题中提取额外信息（CC, Unrated, Extended等）
    function extractExtraInfo(originalTitle) {
        const extraInfoFound = [];

        for (const info of EXTRA_INFO) {
            const infoRegex = new RegExp('\\b' + info + '\\b', 'i');
            if (infoRegex.test(originalTitle)) {
                extraInfoFound.push(info);
            }
        }

        return extraInfoFound.length > 0 ? extraInfoFound : null;
    }

    // 从原始标题中提取片源类型
    function extractSourceType(originalTitle) {
        for (const source of VIDEO_SOURCES) {
            const sourceRegex = new RegExp('\\b' + source + '\\b', 'i');
            if (sourceRegex.test(originalTitle)) {
                return source;
            }
        }
        return null;
    }

    // 从原始标题中提取视频编码
    function extractVideoEncoding(originalTitle) {
        for (const encoding of VIDEO_ENCODINGS) {
            const encodingRegex = new RegExp('\\b' + encoding + '\\b', 'i');
            if (encodingRegex.test(originalTitle)) {
                return encoding;
            }
        }
        return null;
    }

    // 修改：从原始标题中提取制作组，支持更多格式
    function extractReleaseGroup(originalTitle) {
        console.log('青蛙转种助手: 开始提取制作组，原始标题:', originalTitle);

        // 首先检查已知制作组
        for (const group of KNOWN_GROUP) {
            // 对于MNHD-FRDS这种包含连字符的组名
            if (group.includes('-') && !group.startsWith('-')) {
                if (originalTitle.includes(group)) {
                    console.log('青蛙转种助手: 找到已知制作组:', group);
                    return group;
                }
            }
            // 对于-CMCT这种以连字符开头的组名
            else if (group.startsWith('-')) {
                // 确保找到的是组名而不是标题中的其他连字符
                const pos = originalTitle.indexOf(group);
                if (pos !== -1) {
                    // 检查是否在标题末尾或后面跟着空格/标点
                    if (pos + group.length === originalTitle.length ||
                        /[\s.,;!?]/.test(originalTitle[pos + group.length])) {
                        console.log('青蛙转种助手: 找到已知制作组:', group);
                        return group;
                    }
                }
            }
        }

        // 如果没有找到已知制作组，使用通用模式匹配 -XXX 格式
        // 匹配以连字符开头，后跟字母数字的组名，通常出现在标题末尾
        const groupMatches = originalTitle.match(/-[A-Za-z0-9]+(?=\s|$)/g);
        if (groupMatches && groupMatches.length > 0) {
            // 取最后一个匹配项作为制作组（通常制作组在标题末尾）
            const lastMatch = groupMatches[groupMatches.length - 1];
            console.log('青蛙转种助手: 通过通用模式找到制作组:', lastMatch);
            return lastMatch;
        }

        console.log('青蛙转种助手: 未找到制作组');
        return null;
    }

    // 修复：从MediaInfo中提取HDR格式信息，确保不会误判
    function extractHDRFormat() {
        const mediaInfoTextarea = document.querySelector('textarea[name="technical_info"]');
        if (!mediaInfoTextarea || !mediaInfoTextarea.value.trim()) {
            console.log('青蛙转种助手: 未找到mediainfo，无法获取HDR格式');
            return null;
        }

        const mediainfo = mediaInfoTextarea.value;

        // 查找视频部分
        const videoSection = mediainfo.match(/Video.*?((?=Audio)|$)/s);
        if (!videoSection) {
            console.log('青蛙转种助手: 未找到Video部分，无法获取HDR格式');
            return null;
        }

        const videoInfo = videoSection[0];
        console.log('青蛙转种助手: 找到Video部分，开始分析HDR格式');

        // 首先检查SDR明确指标 - 如果是BT.709且不包含HDR特征，就是SDR
        if (
            videoInfo.match(/color primaries\s*:\s*bt\.709/i) &&
            videoInfo.match(/transfer characteristics\s*:\s*bt\.709/i) &&
            !videoInfo.match(/\b(?:HDR|Dolby Vision|DoVi|HLG)\b/i)
        ) {
            console.log('青蛙转种助手: 检测到BT.709色彩空间和传输特性，确认为SDR内容');
            return null;
        }

        // 检查是否包含编码设置中的no-hdr标记
        if (videoInfo.match(/\bno-hdr10\b/i) && !videoInfo.match(/\bdolby\s*vision\b|\bdovi\b/i)) {
            console.log('青蛙转种助手: 检测到no-hdr10标记，确认为SDR内容');
            return null;
        }

        // 检查明确的HDR指标
        // 1. 检查颜色特征 - BT.2020色彩空间与PQ/HLG传输特性是HDR的明确标志
        if (videoInfo.match(/color primaries\s*:\s*bt\.2020/i)) {
            console.log('青蛙转种助手: 检测到BT.2020色彩空间，可能是HDR内容');

            // 检查传输特性
            if (videoInfo.match(/transfer characteristics\s*:\s*pq/i) ||
                videoInfo.match(/transfer characteristics\s*:\s*smpte\s*st\s*2084/i)) {
                console.log('青蛙转种助手: 检测到PQ传输特性，确认为HDR10内容');
                return 'HDR';
            }

            if (videoInfo.match(/transfer characteristics\s*:\s*hlg/i)) {
                console.log('青蛙转种助手: 检测到HLG传输特性，确认为HLG HDR内容');
                return 'HLG';
            }
        }

        // 2. 检查HDR元数据
        if (videoInfo.match(/mastering display color primaries/i) ||
            videoInfo.match(/MaxCLL|MaxFALL/i) ||
            videoInfo.match(/smpte\s*st\s*2086/i)) {
            console.log('青蛙转种助手: 检测到HDR元数据，确认为HDR内容');
            return 'HDR';
        }

        // 3. 检查是否是杜比视界(Dolby Vision)
        if (videoInfo.match(/\b(?<!no-|no )dolby\s*vision\b|\b(?<!no-|no )dovi\b/i)) {
            console.log('青蛙转种助手: 检测到Dolby Vision标记');

            // 检查是否同时支持HDR10+
            if (videoInfo.match(/\b(?<!no-|no )hdr10\+\b/i)) {
                console.log('青蛙转种助手: 同时检测到HDR10+，确认为双层HDR');
                return 'DoVi HDR10+';
            }
            // 检查是否同时支持HDR10
            else if (videoInfo.match(/\b(?<!no-|no )hdr10\b|\b(?<!no-|no )hdr\b(?!\+)/i)) {
                console.log('青蛙转种助手: 同时检测到HDR10，确认为DoVi HDR');
                return 'DoVi HDR';
            }
            // 只有杜比视界
            else {
                return 'DoVi';
            }
        }

        // 4. 检查是否是HDR10+
        if (videoInfo.match(/\b(?<!no-|no )hdr10\+\b/i)) {
            console.log('青蛙转种助手: 检测到HDR10+标记');
            return 'HDR10+';
        }

        // 5. 检查是否是HDR10
        if (videoInfo.match(/\b(?<!no-|no )hdr10\b|\b(?<!no-|no )hdr\b(?!\+)/i) &&
            !videoInfo.match(/no-hdr10\b/i)) {
            console.log('青蛙转种助手: 检测到HDR10标记');
            return 'HDR';
        }

        console.log('青蛙转种助手: 未检测到任何HDR相关特征，确认为SDR内容');
        return null;
    }

    // 从MediaInfo获取音频格式 - 修复E-AC-3识别为DDP而不是DD
    function extractAudioFormat() {
        const mediaInfoTextarea = document.querySelector('textarea[name="technical_info"]');
        if (!mediaInfoTextarea || !mediaInfoTextarea.value.trim()) {
            console.log('青蛙转种助手: 未找到mediainfo，无法获取音频格式');
            return null;
        }

        const mediainfo = mediaInfoTextarea.value;

        // 查找第一个音频部分（通常是主音轨）
        let audioSection = findAudioSection(mediainfo);
        if (!audioSection) {
            console.log('青蛙转种助手: 未找到Audio部分，无法获取音频格式');
            return null;
        }

        // 从Format行提取音频格式
        const formatMatch = audioSection.match(/Format\s*:\s*([^\r\n]+)/i);
        if (!formatMatch) {
            console.log('青蛙转种助手: 未找到音频格式信息');
            return null;
        }

        const formatInfo = formatMatch[1].trim();
        console.log('青蛙转种助手: 从MediaInfo获取到音频格式:', formatInfo);

        // 判断音频格式，将MediaInfo格式映射到标题格式
        // 修复E-AC-3识别为DDP而不是DD
        if (formatInfo.includes('E-AC-3') || formatInfo.includes('EAC3') || formatInfo.includes('Enhanced AC-3')) {
            return 'DDP'; // 修正: 识别为DDP而不是DD
        } else if (formatInfo.includes('AC-3') || formatInfo.includes('AC3')) {
            return 'DD';
        } else if (formatInfo.includes('AAC')) {
            return 'AAC';
        } else if (formatInfo.includes('FLAC')) {
            return 'FLAC';
        } else if (formatInfo.includes('TrueHD')) {
            return formatInfo.includes('Atmos') ? 'TrueHD Atmos' : 'TrueHD';
        } else if (formatInfo.includes('DTS-HD MA')) {
            return 'DTS-HD MA';
        } else if (formatInfo.includes('DTS-HD')) {
            return 'DTS-HD';
        } else if (formatInfo.includes('DTS:X') || formatInfo.includes('DTS-X')) {
            return 'DTS-X';
        } else if (formatInfo.includes('DTS')) {
            return 'DTS';
        } else if (formatInfo.includes('LPCM') || formatInfo.includes('PCM')) {
            return 'LPCM';
        }

        return null;
    }

    // 从MediaInfo获取音频声道数
    function extractAudioChannels() {
        const mediaInfoTextarea = document.querySelector('textarea[name="technical_info"]');
        if (!mediaInfoTextarea || !mediaInfoTextarea.value.trim()) {
            console.log('青蛙转种助手: 未找到mediainfo');
            return null;
        }

        const mediainfo = mediaInfoTextarea.value;

        // 尝试查找音频部分
        let audioSection = findAudioSection(mediainfo);
        if (!audioSection) {
            console.log('青蛙转种助手: 未找到Audio部分');
            return null;
        }

        // 尝试从Channel layout获取声道数
        const layoutMatch = audioSection.match(/Channel layout\s*:\s*(.*)/i);
        if (layoutMatch) {
            const layout = layoutMatch[1].trim();
            console.log('青蛙转种助手: 找到Channel layout:', layout);

            const channels = layout.split(/\s+/);
            let mainChannels = 0;
            let hasLFE = false;

            for (const channel of channels) {
                if (channel === 'LFE') hasLFE = true;
                else mainChannels++;
            }

            const result = mainChannels + (hasLFE ? '.1' : '.0');
            console.log('青蛙转种助手: 从Channel layout计算出声道数:', result);
            return result;
        }

        // 尝试从Channel(s)获取声道数
        const channelsMatch = audioSection.match(/Channel\(s\)\s*:\s*(\d+)\s*channels/i);
        if (channelsMatch) {
            const channelNum = parseInt(channelsMatch[1], 10);
            console.log('青蛙转种助手: 从Channel(s)找到声道数:', channelNum);

            const hasLFE = audioSection.includes('LFE');

            if (channelNum === 6 && hasLFE) return '5.1';
            if (channelNum === 8 && hasLFE) return '7.1';
            if (channelNum === 2) return '2.0';
            return channelNum + '.0';
        }

        return null;
    }

    // 计算MediaInfo中的音轨数量
    function extractAudioTrackCount() {
        const mediaInfoTextarea = document.querySelector('textarea[name="technical_info"]');
        if (!mediaInfoTextarea || !mediaInfoTextarea.value.trim()) {
            console.log('青蛙转种助手: 未找到mediainfo');
            return 0;
        }

        const mediainfo = mediaInfoTextarea.value;

        // 方法1: 查找 "Audio #" 数量
        const audioMatches = mediainfo.match(/Audio #\d+/g);
        if (audioMatches && audioMatches.length > 0) {
            console.log('青蛙转种助手: 找到音轨数量:', audioMatches.length);
            return audioMatches.length;
        }

        // 方法2: 通过格式查找音频部分
        const formatMatches = mediainfo.match(/Format\s*:\s*(AC-3|DTS|AAC|FLAC|MP3|PCM|TrueHD|MLP|E-AC-3)/gi);
        if (formatMatches && formatMatches.length > 0) {
            // 过滤非音频格式的条目
            const audioFormats = formatMatches.filter(match => {
                const contextStart = Math.max(0, mediainfo.indexOf(match) - 150);
                const contextEnd = Math.min(mediainfo.length, mediainfo.indexOf(match) + 150);
                const context = mediainfo.substring(contextStart, contextEnd);
                return context.includes('Audio') ||
                       context.includes('Channel') ||
                       context.includes('Sampling') ||
                       context.includes('channels');
            });

            if (audioFormats.length > 0) {
                console.log('青蛙转种助手: 通过格式匹配找到音轨数量:', audioFormats.length);
                return audioFormats.length;
            }
        }

        // 方法3: 尝试识别单独的音频部分
        const audioSections = mediainfo.split('\n\n').filter(section =>
            section.trim().startsWith('Audio') ||
            (section.includes('Channel layout') && !section.includes('Video')) ||
            (section.includes('Channel(s)') && !section.includes('Video')));

        if (audioSections && audioSections.length > 0) {
            console.log('青蛙转种助手: 通过分段找到音轨数量:', audioSections.length);
            return audioSections.length;
        }

        console.log('青蛙转种助手: 无法确定音轨数量');
        return 0;
    }

    // 查找音频部分
    function findAudioSection(mediainfo) {
        // 方法1: 分割并查找
        const sections = mediainfo.split(/\n\n+/);
        for (const section of sections) {
            if (section.trim().startsWith('Audio') ||
                (section.trim().match(/^ID\s+:\s+\d+\s*\nFormat\s+:\s+/m) &&
                section.includes('Channel'))) {
                console.log('青蛙转种助手: 找到Audio部分');
                return section;
            }
        }

        // 方法2: 正则表达式查找
        const audioMatch = mediainfo.match(/Audio(?:\r?\n|.)*?(?=\n\n|\n[A-Za-z][^:]*:|\n[A-Za-z][^:]*$|$)/);
        if (audioMatch) {
            console.log('青蛙转种助手: 第二种方法找到Audio部分');
            return audioMatch[0];
        }

        // 备选方案: 任何包含Channel信息的部分
        const channelMatch = mediainfo.match(/Channel\(s\)\s*:\s*(\d+)\s*channels/i);
        if (channelMatch) {
            const context = mediainfo.substring(
                Math.max(0, mediainfo.indexOf(channelMatch[0]) - 200),
                Math.min(mediainfo.length, mediainfo.indexOf(channelMatch[0]) + 200)
            );
            return context;
        }

        return null;
    }

    // 修改：构建标准化标题，制作组为可选
    function buildStandardizedTitle(components) {
        let title = '';

        // 电影/剧集名称和年份（必需）
        if (!components.title || !components.year) {
            throw new Error("标题必须包含剧名和年份");
        }

        title += components.title + ' ' + components.year;

        // 添加额外信息（CC, Unrated, Extended等）- 放在年份之后，分辨率之前
        if (components.extraInfo && components.extraInfo.length > 0) {
            for (const info of components.extraInfo) {
                title += ' ' + info;
            }
        }

        // 添加分辨率（如果有）
        if (components.resolution) {
            title += ' ' + components.resolution;
        }

        // 添加地区码（如果有）
        if (components.regionCode) {
            title += ' ' + components.regionCode;
        }

        // 添加片源类型（如果有）
        if (components.sourceType) {
            title += ' ' + components.sourceType;
        }

        // 添加HDR格式信息（如果有）- 放在片源类型之后，视频编码之前
        if (components.hdrFormat) {
            title += ' ' + components.hdrFormat;
        }

        // 添加视频编码（如果有）
        if (components.videoEncoding) {
            title += ' ' + components.videoEncoding;
        }

        // 添加音频编码和声道信息（如果有）
        if (components.audioFormat && components.audioChannels) {
            title += ' ' + components.audioFormat + ' ' + components.audioChannels;
        }

        // 添加音轨数（如果多于1个音轨）
        if (components.audioTrackCount > 1) {
            title += ' ' + components.audioTrackCount + 'Audio';
        }

        // 添加制作组（如果有）
        if (components.releaseGroup) {
            // 如果制作组以连字符开头，不需要额外空格
            if (components.releaseGroup.startsWith('-')) {
                title += components.releaseGroup;
            } else {
                title += ' ' + components.releaseGroup;
            }
        }

        return title;
    }

    // 修改：标题规范化处理，制作组为可选
    function standardizeTitle() {
        console.log('青蛙转种助手: 开始重建标题');

        const titleInput = document.getElementById('name');
        if (!titleInput || !titleInput.value.trim()) {
            alert('未找到标题输入框或标题为空');
            return;
        }

        const originalTitle = titleInput.value;
        console.log('青蛙转种助手: 原始标题:', originalTitle);

        try {
            // 从原始标题提取各个组件
            const titleComponents = {
                title: extractTitle(originalTitle),
                year: extractYear(originalTitle),
                resolution: extractResolution(originalTitle),
                regionCode: extractRegionCode(originalTitle),
                extraInfo: extractExtraInfo(originalTitle), // 提取额外信息
                sourceType: extractSourceType(originalTitle),
                videoEncoding: extractVideoEncoding(originalTitle),
                releaseGroup: extractReleaseGroup(originalTitle), // 可能为null
                hdrFormat: extractHDRFormat(), // 新增: 提取HDR格式
                audioFormat: extractAudioFormat(),
                audioChannels: extractAudioChannels(),
                audioTrackCount: extractAudioTrackCount()
            };

            // 检查必需组件
            if (!titleComponents.title || !titleComponents.year) {
                throw new Error("标题必须包含剧名和年份");
            }

            // 检查MediaInfo是否存在
            if (!titleComponents.audioFormat || !titleComponents.audioChannels) {
                throw new Error("请先添加MediaInfo或确保MediaInfo包含音频信息");
            }

            // 打印提取的组件
            console.log('青蛙转种助手: 提取的标题组件:', titleComponents);

            // 构建标准化标题
            const standardizedTitle = buildStandardizedTitle(titleComponents);
            console.log('青蛙转种助手: 重建的标题:', standardizedTitle);

            // 更新标题
            titleInput.value = standardizedTitle;

            // 移除成功提示，只在控制台记录
            console.log('青蛙转种助手: 标题重建成功');
        } catch (error) {
            console.error('青蛙转种助手: 重建标题失败', error);
            alert('重建标题失败: ' + error.message);
        }
    }
})();