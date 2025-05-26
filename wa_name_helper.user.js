// ==UserScript==
// @name         蛙蛙命名助手
// @namespace    http://tampermonkey.net/
// @version      1.8.2
// @description  根据原标题和MediaInfo，构建符合蛙蛙要求的种子主标题
// @author       andie
// @match        https://www.qingwapt.org/upload.php*
// @match        https://new.qingwa.pro/upload.php*
// @match        https://www.qingwapt.com/upload.php*
// @grant        none
// @downloadURL https://github.com/Andiedie/MyScripts/raw/refs/heads/main/wa_name_helper.user.js
// @updateURL https://github.com/Andiedie/MyScripts/raw/refs/heads/main/wa_name_helper.user.js
// ==/UserScript==

(function() {
    'use strict';

    // 常量定义 - 使用对象简化映射
    const FORMAT_MAPPINGS = {
        // 视频格式映射
        video: {
            patterns: [
                { regex: /hevc|h\.265/i, getValue: (lib) => lib.includes('x265') ? 'x265' : 'H.265' },
                { regex: /avc|h\.264/i, getValue: (lib, bitDepth) => {
                    const encoding = lib.includes('x264') ? 'x264' : 'H.264';
                    return bitDepth === 10 ? `Hi10P ${encoding}` : encoding;
                }}
            ]
        },
        // 音频格式映射
        audio: {
            'E-AC-3': 'DDP', 'EAC3': 'DDP', 'Enhanced AC-3': 'DDP',
            'AC-3': 'DD', 'AC3': 'DD',
            'AAC': 'AAC', 'FLAC': 'FLAC', 'LPCM': 'LPCM', 'PCM': 'LPCM',
            'TrueHD': 'TrueHD', 'DTS-HD MA': 'DTS-HD MA', 'DTS-HD': 'DTS-HD',
            'DTS:X': 'DTS-X', 'DTS-X': 'DTS-X', 'DTS': 'DTS'
        },
        // HDR格式检测规则
        hdr: [
            { name: 'DoVi HDR10+', test: (info) => /dolby\s*vision|dovi/i.test(info) && /hdr10\+/i.test(info) },
            { name: 'DoVi HDR', test: (info) => /dolby\s*vision|dovi/i.test(info) && /hdr(?!\+)/i.test(info) },
            { name: 'DoVi', test: (info) => /dolby\s*vision|dovi/i.test(info) },
            { name: 'HDR10+', test: (info) => /hdr10\+/i.test(info) },
            { name: 'HDR', test: (info) => /hdr|smpte\s*st\s*2086|mastering display|MaxCLL|MaxFALL/i.test(info) && !/no-hdr/i.test(info) }
        ]
    };

    // 分辨率映射定义
    const RESOLUTION_MAPPINGS = [
        { dimensions: [1280, 720], value: '720' },
        { dimensions: [1920, 1080], value: '1080' },
        { dimensions: [3840, 2160], value: '2160' }
    ];

    const REGION_CODES = ['JPN', 'CHN', 'USA', 'KOR', 'FRA', 'GER', 'DEU', 'ITA', 'ESP', 'GBR', 'CAN', 'AUS', 'TWN', 'TW', 'HKG', 'NOR'];
    const EXTRA_INFO = ['CC', 'Unrated', 'Extended', 'Uncut', 'Complete Edition', 'Remaster'];
    const VIDEO_SOURCES = ['BluRay', 'WEB-DL', 'WebRip', 'HDTV', 'DVDRip', 'BDRip', 'TVRip'];
    const KNOWN_GROUP = ['MNHD-FRDS'];

    // 全局变量
    let formatBtn = null;
    let toolCell = null;
    let errorMessage = null;

    // 日志工具
    const Logger = {
        prefix: '命名助手',
        log: (msg, data = '') => console.log(`${Logger.prefix}: ${msg}`, data),
        error: (msg, error = '') => console.error(`${Logger.prefix}: ${msg}`, error),
        group: (title, fn) => {
            console.group(`${Logger.prefix}: ${title}`);
            const result = fn();
            console.groupEnd();
            return result;
        }
    };

    // MediaInfo 统一解析类
    class MediaInfoParser {
        constructor() {
            this.mediaInfo = this.getMediaInfoText();
            this.sections = this.parseToSections();
            Logger.log('MediaInfo解析器初始化', {
                hasContent: !!this.mediaInfo,
                length: this.mediaInfo.length
            });
        }

        getMediaInfoText() {
            const textarea = document.querySelector('textarea[name="technical_info"]');
            return textarea?.value?.trim() || '';
        }

        parseToSections() {
            if (!this.mediaInfo) return { video: null, audio: null };

            // 统一的部分查找逻辑
            const findSection = (type) => {
                const patterns = {
                    video: /Video.*?(?=\n\n|Audio|$)/s,
                    audio: /Audio.*?(?=\n\n|Video|$)/s
                };

                const match = this.mediaInfo.match(patterns[type]);
                const found = match ? match[0] : null;
                Logger.log(`找到${type}部分`, !!found);
                return found;
            };

            return Logger.group('解析MediaInfo部分', () => ({
                video: findSection('video'),
                audio: findSection('audio')
            }));
        }

        // 通用信息提取方法
        extractInfo(section, field) {
            if (!section) return null;
            const match = section.match(new RegExp(`${field}\\s*:\\s*([^\\r\\n]+)`, 'i'));
            return match ? match[1].trim() : null;
        }

        // 从 MediaInfo 提取分辨率
        getResolution() {
            return Logger.group('从MediaInfo提取分辨率', () => {
                const videoSection = this.sections.video;
                if (!videoSection) {
                    Logger.log('无视频部分');
                    return null;
                }

                // 提取宽度和高度
                const widthStr = this.extractInfo(videoSection, 'Width');
                const heightStr = this.extractInfo(videoSection, 'Height');

                if (!widthStr || !heightStr) {
                    Logger.log('未找到宽度或高度信息');
                    return null;
                }

                // 解析数值（去除单位和格式化）
                const width = parseInt(widthStr.replace(/[^\d]/g, ''), 10);
                const height = parseInt(heightStr.replace(/[^\d]/g, ''), 10);

                Logger.log('视频尺寸', { width, height });

                // 匹配分辨率
                for (const mapping of RESOLUTION_MAPPINGS) {
                    const [targetWidth, targetHeight] = mapping.dimensions;
                    if (width === targetWidth || height === targetHeight) {
                        Logger.log(`分辨率匹配`, `${width}x${height} -> ${mapping.value}`);

                        // 获取扫描类型
                        const scanType = this.getScanType();
                        const suffix = scanType === 'Interlaced' ? 'i' : 'p';
                        const result = `${mapping.value}${suffix}`;

                        Logger.log('最终分辨率', result);
                        return result;
                    }
                }

                Logger.log('未匹配到标准分辨率', `${width}x${height}`);
                return null;
            });
        }

        // 获取扫描类型
        getScanType() {
            const videoSection = this.sections.video;
            if (!videoSection) return 'Progressive';

            const scanType = this.extractInfo(videoSection, 'Scan type');
            const result = scanType || 'Progressive';
            Logger.log('扫描类型', result);
            return result;
        }

        // 视频编码提取
        getVideoEncoding() {
            return Logger.group('提取视频编码', () => {
                const videoSection = this.sections.video;
                if (!videoSection) {
                    Logger.log('无视频部分');
                    return null;
                }

                const format = this.extractInfo(videoSection, 'Format');
                const writingLibrary = this.extractInfo(videoSection, 'Writing library')?.toLowerCase() || '';
                const bitDepthMatch = videoSection.match(/Bit depth\s*:\s*(\d+)\s*bits/i);
                const bitDepth = bitDepthMatch ? parseInt(bitDepthMatch[1], 10) : 8;

                Logger.log('视频信息', { format, writingLibrary, bitDepth });

                // 使用映射表简化格式判断
                for (const pattern of FORMAT_MAPPINGS.video.patterns) {
                    if (pattern.regex.test(format)) {
                        const result = pattern.getValue(writingLibrary, bitDepth);
                        Logger.log('视频编码结果', result);
                        return result;
                    }
                }

                Logger.log('未识别的视频格式', format);
                return null;
            });
        }

        // 音频格式提取
        getAudioFormat() {
            return Logger.group('提取音频格式', () => {
                const audioSection = this.sections.audio;
                if (!audioSection) {
                    Logger.log('无音频部分');
                    return null;
                }

                const format = this.extractInfo(audioSection, 'Format');
                if (!format) {
                    Logger.log('未找到音频格式信息');
                    return null;
                }

                Logger.log('音频格式原始值', format);

                // 特殊处理 TrueHD Atmos
                if (format.includes('TrueHD') && format.includes('Atmos')) {
                    Logger.log('音频格式结果', 'TrueHD Atmos');
                    return 'TrueHD Atmos';
                }

                // 使用映射表查找格式
                for (const [key, value] of Object.entries(FORMAT_MAPPINGS.audio)) {
                    if (format.includes(key)) {
                        Logger.log('音频格式结果', `${key} -> ${value}`);
                        return value;
                    }
                }

                Logger.log('未识别的音频格式', format);
                return null;
            });
        }

        // 音频声道数提取
        getAudioChannels() {
            return Logger.group('提取音频声道', () => {
                const audioSection = this.sections.audio;
                if (!audioSection) {
                    Logger.log('无音频部分');
                    return null;
                }

                // 优先从 Channel layout 获取
                const layoutMatch = audioSection.match(/Channel layout\s*:\s*(.*)/i);
                if (layoutMatch) {
                    const layout = layoutMatch[1].trim();
                    const channels = layout.split(/\s+/);
                    const mainChannels = channels.filter(ch => ch !== 'LFE').length;
                    const hasLFE = channels.includes('LFE');
                    const result = `${mainChannels}.${hasLFE ? '1' : '0'}`;
                    Logger.log('声道布局解析', { layout, channels, result });
                    return result;
                }

                // 从 Channel(s) 获取
                const channelsMatch = audioSection.match(/Channel\(s\)\s*:\s*(\d+)\s*channels/i);
                if (channelsMatch) {
                    const num = parseInt(channelsMatch[1], 10);
                    const hasLFE = audioSection.includes('LFE');

                    // 常见格式快速映射
                    const channelMap = { 6: '5.1', 8: '7.1', 2: '2.0' };
                    const result = (hasLFE && channelMap[num]) ? channelMap[num] : `${num}.0`;
                    Logger.log('声道数解析', { num, hasLFE, result });
                    return result;
                }

                Logger.log('未找到声道信息');
                return null;
            });
        }

        // HDR格式提取
        getHDRFormat() {
            return Logger.group('提取HDR格式', () => {
                const videoSection = this.sections.video;
                if (!videoSection) {
                    Logger.log('无视频部分');
                    return null;
                }

                // 检查SDR特征
                if (this.isSDRContent(videoSection)) {
                    Logger.log('检测到SDR内容');
                    return null;
                }

                // 按优先级检查HDR格式
                for (const hdr of FORMAT_MAPPINGS.hdr) {
                    if (hdr.test(videoSection)) {
                        Logger.log('HDR格式结果', hdr.name);
                        return hdr.name;
                    }
                }

                Logger.log('未检测到HDR格式');
                return null;
            });
        }

        isSDRContent(videoSection) {
            const isSDR = (
                /color primaries\s*:\s*bt\.709/i.test(videoSection) &&
                /transfer characteristics\s*:\s*bt\.709/i.test(videoSection) &&
                !/\b(?:HDR|Dolby Vision|DoVi|HLG)\b/i.test(videoSection)
            ) || (/\bno-hdr10\b/i.test(videoSection) && !/\bdolby\s*vision\b|\bdovi\b/i.test(videoSection));

            if (isSDR) Logger.log('SDR特征检测', 'BT.709色彩空间或no-hdr标记');
            return isSDR;
        }

        // 音轨数量统计
        getAudioTrackCount() {
            if (!this.mediaInfo) return 0;

            const audioMatches = this.mediaInfo.match(/Audio #\d+/g);
            const count = audioMatches ? audioMatches.length : 0;
            Logger.log('音轨数量', count);
            return count;
        }

        // 检查解析是否成功
        isValid() {
            const audioFormat = this.getAudioFormat();
            const audioChannels = this.getAudioChannels();
            const isValid = !!(audioFormat && audioChannels);
            Logger.log('MediaInfo有效性检查', { audioFormat, audioChannels, isValid });
            return isValid;
        }
    }

    // 标题组件提取器
    class TitleExtractor {
        constructor(originalTitle) {
            this.title = originalTitle;
            Logger.log('标题提取器初始化', originalTitle);
        }

        extract(pattern, defaultValue = null) {
            const match = this.title.match(pattern);
            return match ? match[0] : defaultValue;
        }

        extractFromList(list, ignoreCase = true) {
            const flags = ignoreCase ? 'i' : '';
            for (const item of list) {
                const regex = new RegExp('\\b' + item + '\\b', flags);
                if (regex.test(this.title)) return item;
            }
            return null;
        }

        getComponents() {
            return Logger.group('提取标题组件', () => {
                const components = {
                    title: this.getTitle(),
                    seasonEpisode: this.getSeasonEpisode(),
                    year: this.extract(/\b(19\d{2}|20\d{2})\b/),
                    regionCode: this.extractFromList(REGION_CODES),
                    extraInfo: this.getExtraInfo(),
                    sourceType: this.extractFromList(VIDEO_SOURCES),
                    releaseGroup: this.getReleaseGroup()
                };

                Logger.log('标题组件提取结果', components);
                return components;
            });
        }

        getTitle() {
            // 先找到年份的位置
            const yearMatch = this.title.match(/\b(19\d{2}|20\d{2})\b/);

            // 如果有年份，标题是年份之前的部分
            if (yearMatch) {
                const yearIndex = this.title.indexOf(yearMatch[0]);
                const titlePart = this.title.substring(0, yearIndex).trim();
                Logger.log('剧名提取(基于年份)', titlePart);
                return titlePart;
            }

            // 如果没有年份，但有季数集数信息，标题是季数集数之前的部分
            const seasonMatch = this.title.match(/\bS\d+(?:E\d+)?(?:-S\d+)?/i);
            if (seasonMatch) {
                const seasonIndex = this.title.indexOf(seasonMatch[0]);
                const titlePart = this.title.substring(0, seasonIndex).trim();
                Logger.log('剧名提取(基于季数)', titlePart);
                return titlePart;
            }

            // 否则返回整个标题
            const result = this.title.trim();
            Logger.log('剧名提取(完整标题)', result);
            return result;
        }

        getSeasonEpisode() {
            return Logger.group('提取季数集数信息', () => {
                // 支持的格式：
                // S01, S01E03, S02E2134, S01-S02
                const patterns = [
                    /\bS\d+(?:-S\d+)\b/i,      // S01-S02 (季度范围)
                    /\bS\d+E\d+\b/i,           // S01E03 (季数+集数)
                    /\bS\d+\b/i                // S01 (仅季数)
                ];

                for (const pattern of patterns) {
                    const match = this.title.match(pattern);
                    if (match) {
                        const result = match[0].toUpperCase(); // 统一转为大写
                        Logger.log('季数集数匹配', { pattern: pattern.source, result });
                        return result;
                    }
                }

                Logger.log('未找到季数集数信息');
                return null;
            });
        }

        getExtraInfo() {
            const found = [];
            for (const info of EXTRA_INFO) {
                if (new RegExp('\\b' + info + '\\b', 'i').test(this.title)) {
                    found.push(info);
                }
            }
            const result = found.length > 0 ? found : null;
            if (result) Logger.log('额外信息', result);
            return result;
        }

        getReleaseGroup() {
            // 检查已知制作组
            for (const group of KNOWN_GROUP) {
                if (this.title.includes(group)) {
                    Logger.log('制作组(已知)', group);
                    return group;
                }
            }

            // 通用模式匹配
            const matches = this.title.match(/-[A-Za-z0-9]+(?=\s|$)/g);
            const result = matches ? matches[matches.length - 1] : null;
            if (result) Logger.log('制作组(通用)', result);
            return result;
        }
    }

    // 标题构建器
    class TitleBuilder {
        static build(components) {
            return Logger.group('构建标准化标题', () => {
                const parts = [
                    components.title,
                    components.seasonEpisode,     // 季数集数紧跟在剧名后面
                    components.year,
                    ...(components.extraInfo || []),
                    components.resolution,  // 现在来自 MediaInfo
                    components.regionCode,
                    components.sourceType,
                    components.hdrFormat,
                    components.videoEncoding,
                    components.audioFormat && components.audioChannels ?
                        `${components.audioFormat} ${components.audioChannels}` : null,
                    components.audioTrackCount > 1 ? `${components.audioTrackCount}Audio` : null
                ].filter(Boolean);

                let title = parts.join(' ');

                // 添加制作组
                if (components.releaseGroup) {
                    title += components.releaseGroup.startsWith('-') ?
                        components.releaseGroup : ` ${components.releaseGroup}`;
                }

                Logger.log('标题构建完成', title);
                Logger.log('使用的组件', parts);
                return title;
            });
        }
    }

    // 初始化界面
    window.addEventListener('load', initUI);

    function initUI() {
        Logger.log('脚本已加载');

        const publishBtn = document.querySelector('input[type="submit"][value="发布"]');
        if (!publishBtn) return;

        const tableRows = document.querySelector('form > table > tbody').querySelectorAll('tr');
        const firstRow = tableRows[0];

        // 创建工具栏
        const toolRow = document.createElement('tr');
        toolCell = document.createElement('td');
        toolCell.className = 'toolbox';
        toolCell.align = 'center';
        toolCell.colSpan = '2';

        formatBtn = document.createElement('input');
        formatBtn.type = 'button';
        formatBtn.value = '重建标题';
        formatBtn.style.marginRight = '10px';
        formatBtn.addEventListener('click', standardizeTitle);

        publishBtn.parentNode.removeChild(publishBtn);
        toolCell.appendChild(formatBtn);
        toolCell.appendChild(publishBtn);
        toolRow.appendChild(toolCell);
        firstRow.parentNode.insertBefore(toolRow, firstRow);

        // 添加MediaInfo监听
        const mediaInfoTextarea = document.querySelector('textarea[name="technical_info"]');
        if (mediaInfoTextarea) {
            mediaInfoTextarea.addEventListener('input', handleMediaInfoChange);
        }

        // 清理重复工具栏
        const lastRow = tableRows[tableRows.length - 1];
        if (lastRow.querySelector('.toolbox') && lastRow !== toolRow) {
            lastRow.parentNode.removeChild(lastRow);
        }

        setTimeout(handleMediaInfoChange, 500);
    }

    function handleMediaInfoChange() {
        Logger.log('MediaInfo内容变化，开始解析');
        const parser = new MediaInfoParser();

        removeErrorMessage();

        if (!parser.mediaInfo) {
            Logger.log('MediaInfo为空');
            showButton();
            return;
        }

        if (parser.isValid()) {
            Logger.log('MediaInfo解析成功');
            showButton();
        } else {
            Logger.log('MediaInfo解析失败');
            showError();
        }
    }

    function showButton() {
        if (formatBtn) formatBtn.style.display = '';
    }

    function showError() {
        if (!errorMessage) {
            errorMessage = document.createElement('span');
            errorMessage.textContent = 'MediaInfo 解析失败';
            errorMessage.style.cssText = 'color: red; font-weight: bold; margin-right: 10px;';
            if (toolCell) toolCell.insertBefore(errorMessage, formatBtn);
        }
        if (formatBtn) formatBtn.style.display = 'none';
    }

    function removeErrorMessage() {
        if (errorMessage?.parentNode) {
            errorMessage.parentNode.removeChild(errorMessage);
            errorMessage = null;
        }
    }

    function standardizeTitle() {
        Logger.group('开始重建标题', () => {
            const titleInput = document.getElementById('name');
            if (!titleInput?.value.trim()) {
                alert('未找到标题输入框或标题为空');
                return;
            }

            Logger.log('原始标题', titleInput.value);

            try {
                const parser = new MediaInfoParser();
                const extractor = new TitleExtractor(titleInput.value);

                // 合并所有组件
                const components = {
                    ...extractor.getComponents(),
                    resolution: parser.getResolution(),  // 从 MediaInfo 获取分辨率
                    videoEncoding: parser.getVideoEncoding(),
                    hdrFormat: parser.getHDRFormat(),
                    audioFormat: parser.getAudioFormat(),
                    audioChannels: parser.getAudioChannels(),
                    audioTrackCount: parser.getAudioTrackCount()
                };

                Logger.log('最终组件汇总', components);

                // 验证必需组件
                if (!components.title) {
                    throw new Error("标题必须包含剧名");
                }

                if (!components.audioFormat || !components.audioChannels) {
                    throw new Error("请先添加MediaInfo或确保MediaInfo包含音频信息");
                }

                const standardizedTitle = TitleBuilder.build(components);
                titleInput.value = standardizedTitle;

                Logger.log('标题重建成功! ✅');
            } catch (error) {
                Logger.error('重建标题失败', error);
                alert('重建标题失败: ' + error.message);
            }
        });
    }
})();
