/**
 * Markdown 渲染核心（Webview 共用）
 *
 * 供 commentInput / shareComment 等页面调用：只负责 Markdown → HTML 字符串，
 * 不负责写入 DOM、IPC、滚动同步或 Mermaid 缩放交互（zoomChart 仍由各页面挂载）。
 *
 * 依赖（须先于本脚本加载）：marked、mermaid、katex；highlight 可选（via waitForHighlight）。
 *
 * 用法：
 *   var core = window.MarkdownRenderCore.create({ handDrawnEnabled: false });
 *   await core.waitForLibs();                    // 注释预览：marked + mermaid + highlight
 *   await core.waitForMermaid();                 // 文件预览：仅 mermaid（marked 自管）
 *   var html = await core.renderMarkdownToHtml(markdownText);
 *   core.wrapMermaidChartHtml(id, svg);          // 或 MarkdownRenderCore.wrapMermaidChartHtml
 *   core.reinitializeMermaid({ handDrawnEnabled, theme });
 *
 * 渲染顺序（勿随意调换）：
 *   1. ${标签} 占位（避免被 KaTeX 的 $ 正则误伤）
 *   2. 提取 ```mermaid，并行 mermaid.render，控件 HTML 暂存
 *   3. KaTeX $$ / $
 *   4. 恢复标签声明 HTML
 *   5. marked.parse
 *   6. @tag → span.tag-link（在 HTML 中后处理，跳过 pre/code，按白名单精确匹配）
 *   7. 将 language-mermaid 代码块换为已渲染 SVG（避免 SVG 内 <style> 被 marked 当文本）
 */
(function (global) {
    'use strict';

    /** @param {boolean} handDrawnEnabled @param {string} [theme] */
    function buildMermaidConfig(handDrawnEnabled, theme) {
        var config = {
            startOnLoad: false,
            theme: theme || 'default',
            flowchart: {
                useMaxWidth: true,
                htmlLabels: true,
                curve: handDrawnEnabled ? 'basis' : 'linear'
            },
            sequence: {
                useMaxWidth: true
            },
            gantt: {
                useMaxWidth: true
            }
        };

        if (handDrawnEnabled) {
            config.look = 'handDrawn';
            config.handDrawn = {
                jitter: 5,
                roughness: 5,
                seed: 20
            };
        }

        return config;
    }

    /**
     * 包装 Mermaid SVG；缩放按钮依赖页面全局 zoomChart / resetChart。
     * @param {string} chartId
     * @param {string} svg
     */
    function wrapMermaidChartHtml(chartId, svg) {
        return '<div class="mermaid-chart" data-chart-id="' + chartId + '">' +
            '<div class="mermaid-controls">' +
            '<button type="button" class="mermaid-control-btn" title="放大" onclick="zoomChart(\'' + chartId + '\', 1.2)">+</button>' +
            '<button type="button" class="mermaid-control-btn" title="缩小" onclick="zoomChart(\'' + chartId + '\', 0.8)">−</button>' +
            '<button type="button" class="mermaid-control-btn" title="重置" onclick="resetChart(\'' + chartId + '\')">↺</button>' +
            '</div>' +
            '<div class="mermaid-zoom-info" id="zoom-info-' + chartId + '">100%</div>' +
            svg +
            '</div>';
    }

    /** @deprecated 使用 wrapMermaidChartHtml */
    function wrapMermaidSvg(chartId, svg) {
        return wrapMermaidChartHtml(chartId, svg);
    }

    /**
     * 创建渲染实例（每 Webview 面板一个，避免初始化状态互相覆盖）。
     * @param {{ handDrawnEnabled?: boolean }} [options]
     * @returns {{
     *   waitForLibs: () => Promise<void>,
     *   renderMarkdownToHtml: (content: string) => Promise<string>,
     *   reinitializeMermaid: (opts?: { handDrawnEnabled?: boolean }) => boolean
     * }}
     */
    function create(options) {
        options = options || {};
        var markedInitialized = false;
        var mermaidInitialized = false;
        var handDrawnEnabled = !!options.handDrawnEnabled;
        /** 缓存首次 waitForLibs，避免重复轮询 */
        var libsPromise = null;

        function initializeMarked() {
            if (typeof marked === 'undefined' || markedInitialized) {
                return markedInitialized;
            }
            var renderer = new marked.Renderer();
            var originalCode = renderer.code;
            renderer.code = function (code, language) {
                // mermaid 不交给 highlight.js，否则 language-mermaid 会被覆盖，后续无法替换 SVG
                if (language === 'mermaid') {
                    return '<pre><code class="language-mermaid">' + code + '</code></pre>';
                }
                if (!language) {
                    return originalCode.call(this, code, language);
                }
                if (typeof hljs !== 'undefined') {
                    try {
                        if (hljs.getLanguage(language)) {
                            var highlighted = hljs.highlight(code, { language: language }).value;
                            return '<pre><code class="hljs language-' + language + '">' + highlighted + '</code></pre>';
                        }
                        var result = hljs.highlightAuto(code);
                        return '<pre><code class="hljs language-' + result.language + '">' + result.value + '</code></pre>';
                    } catch (error) {
                        console.warn('代码高亮失败:', error);
                        return originalCode.call(this, code, language);
                    }
                }
                return originalCode.call(this, code, language);
            };
            marked.setOptions({
                breaks: true,
                gfm: true,
                sanitize: false,
                renderer: renderer
            });
            markedInitialized = true;
            return true;
        }

        function waitForMarked() {
            return new Promise(function (resolve) {
                function check() {
                    if (initializeMarked()) {
                        resolve();
                    } else {
                        setTimeout(check, 100);
                    }
                }
                check();
            });
        }

        /**
         * @param {boolean} [handDrawn] 传入则更新手绘开关后再 initialize
         * @param {string} [theme] Mermaid 主题名（非手绘时常用）
         */
        function initializeMermaid(handDrawn, theme) {
            if (typeof handDrawn === 'boolean') {
                handDrawnEnabled = handDrawn;
            }
            if (typeof mermaid === 'undefined') {
                return false;
            }
            mermaid.initialize(buildMermaidConfig(handDrawnEnabled, theme));
            mermaidInitialized = true;
            return true;
        }

        function waitForMermaid() {
            return new Promise(function (resolve, reject) {
                var attempts = 0;
                var maxAttempts = 50; // 约 5s
                function check() {
                    attempts++;
                    if (typeof mermaid !== 'undefined') {
                        if (initializeMermaid()) {
                            resolve();
                            return;
                        }
                    }
                    if (attempts >= maxAttempts) {
                        reject(new Error('mermaid库加载超时'));
                    } else {
                        setTimeout(check, 100);
                    }
                }
                check();
            });
        }

        /** 等待 marked / mermaid / highlight 就绪（可重复调用，共用同一 Promise） */
        function waitForLibs() {
            if (!libsPromise) {
                libsPromise = Promise.all([
                    waitForMarked(),
                    waitForMermaid(),
                    typeof global.waitForHighlight === 'function'
                        ? global.waitForHighlight()
                        : Promise.resolve()
                ]);
            }
            return libsPromise;
        }

        /**
         * 在 marked.parse 之前处理 LaTeX：先块级 $$，再行内 $，避免互相误匹配。
         * @param {string} finalContent
         */
        function applyKatex(finalContent) {
            if (typeof katex === 'undefined') {
                console.warn('KaTeX 未加载，无法渲染 LaTeX 公式');
                return finalContent;
            }
            try {
                finalContent = finalContent.replace(/\$\$([\s\S]*?)\$\$/g, function (match, formula) {
                    try {
                        return katex.renderToString(formula.trim(), {
                            displayMode: true,
                            throwOnError: false
                        });
                    } catch (error) {
                        console.error('KaTeX 块级公式渲染失败:', error);
                        return '<span class="katex-error">公式渲染失败: ' + formula + '</span>';
                    }
                });
                finalContent = finalContent.replace(/(?<!\$)\$(?!\$)([^\$\n]+?)\$(?!\$)/g, function (match, formula) {
                    try {
                        return katex.renderToString(formula.trim(), {
                            displayMode: false,
                            throwOnError: false
                        });
                    } catch (error) {
                        console.error('KaTeX 行内公式渲染失败:', error);
                        return '<span class="katex-error">公式渲染失败: ' + formula + '</span>';
                    }
                });
            } catch (error) {
                console.error('LaTeX 公式处理失败:', error);
            }
            return finalContent;
        }

        /** 将 HTML 按 pre/code 块拆段，便于在块外做后处理 */
        function splitHtmlPreservingCodeBlocks(html) {
            var parts = [];
            var regex = /(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>)/gi;
            var lastIndex = 0;
            var match;
            while ((match = regex.exec(html)) !== null) {
                if (match.index > lastIndex) {
                    parts.push({ preserved: false, html: html.slice(lastIndex, match.index) });
                }
                parts.push({ preserved: true, html: match[0] });
                lastIndex = match.index + match[0].length;
            }
            if (lastIndex < html.length) {
                parts.push({ preserved: false, html: html.slice(lastIndex) });
            }
            return parts;
        }

        /**
         * 在 HTML 中（跳过 pre/code）将 @tag 替换为可点击链接。
         * - 传入白名单时仅匹配真实存在的标签（与 .md 预览一致，避免误伤普通 @xxx）。
         * - 未传入白名单时回退到原「所有 @xxx 均视为标签」的行为。
         * @param {string} html
         * @param {string[]|undefined} availableTagNames
         */
        function applyTagLinksInHtml(html, availableTagNames) {
            return splitHtmlPreservingCodeBlocks(html).map(function (part) {
                if (part.preserved) {
                    return part.html;
                }
                var segment = part.html;
                if (availableTagNames && availableTagNames.length > 0) {
                    var tagPattern = availableTagNames.map(function (name) {
                        return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    }).join('|');
                    var tagRegex = new RegExp('@(' + tagPattern + ')', 'g');
                    segment = segment.replace(tagRegex, function (match, tagName) {
                        return '<span class="tag-link" data-tag="' + tagName + '" style="color: var(--vscode-symbolIcon-functionForeground); font-weight: bold; cursor: pointer; text-decoration: underline;">' + match + '</span>';
                    });
                } else {
                    segment = segment.replace(
                        /@([\u4e00-\u9fa5a-zA-Z0-9_]+)/g,
                        '<span class="tag-link" data-tag="$1" style="color: var(--vscode-symbolIcon-functionForeground); font-weight: bold; cursor: pointer; text-decoration: underline;">@$1</span>'
                    );
                }
                return segment;
            }).join('');
        }

        /**
         * Markdown → HTML（含标签、KaTeX、Mermaid）。单块 Mermaid 失败不阻断整页。
         * @param {string} content
         * @param {string[]|undefined} [availableTagNames] 可用标签白名单；传入时仅渲染真实存在的 @tag
         * @returns {Promise<string>}
         */
        async function renderMarkdownToHtml(content, availableTagNames) {
            await waitForLibs();

            // ${标签} 先占位，支持中文标签名
            var tagPlaceholders = new Map();
            var processedContent = String(content).replace(
                /\$\{([\u4e00-\u9fa5a-zA-Z_][\u4e00-\u9fa5a-zA-Z0-9_]*)\}/g,
                function (match, tagName) {
                    var placeholder = '__TAG_DECL_PLACEHOLDER_' + tagPlaceholders.size + '__';
                    tagPlaceholders.set(placeholder, { original: match, tagName: tagName });
                    return placeholder;
                }
            );

            // Mermaid：先渲染 SVG，围栏原文留给 marked，解析后再替换
            var mermaidRegex = /```mermaid\n([\s\S]*?)```/g;
            var mermaidBlocks = Array.from(processedContent.matchAll(mermaidRegex));
            var renderedSvgs = await Promise.all(mermaidBlocks.map(async function (match, index) {
                var chartDefinition = match[1].trim();
                var chartId = 'mermaid-chart-' + Date.now() + '-' + index;
                try {
                    var result = await mermaid.render(chartId, chartDefinition);
                    return wrapMermaidSvg(chartId, result.svg);
                } catch (error) {
                    console.error('渲染Mermaid图表失败: ' + chartId, error);
                    return '<div class="mermaid-error">图表渲染失败: ' + error.message +
                        '<pre>' + chartDefinition + '</pre></div>';
                }
            }));

            var finalContent = applyKatex(processedContent);
            tagPlaceholders.forEach(function (tagInfo, placeholder) {
                finalContent = finalContent.replace(
                    placeholder,
                    '<span class="tag-declaration" style="color: var(--vscode-symbolIcon-variableForeground); font-weight: bold;">' +
                        tagInfo.original + '</span>'
                );
            });

            var finalHtml = marked.parse(finalContent);

            // @tag 链接放在 marked.parse 之后处理，避免误伤代码块 / KaTeX 输出中的 @
            finalHtml = applyTagLinksInHtml(finalHtml, availableTagNames);

            var svgIndex = 0;
            var mermaidCodeBlockRegex = /<pre><code class="language-mermaid">[\s\S]*?<\/code><\/pre>/g;
            return finalHtml.replace(mermaidCodeBlockRegex, function () {
                return renderedSvgs[svgIndex++] || '';
            });
        }

        /**
         * 切换手绘/主题后调用；会清空 libsPromise，下次 waitForLibs / render 可重新走初始化。
         * @param {{ handDrawnEnabled?: boolean, theme?: string }} [opts]
         */
        function reinitializeMermaid(opts) {
            opts = opts || {};
            libsPromise = null;
            mermaidInitialized = false;
            var handDrawn = !!opts.handDrawnEnabled;
            var theme = opts.theme;
            return initializeMermaid(handDrawn, theme);
        }

        return {
            waitForLibs: waitForLibs,
            /** 仅等待 Mermaid（preview 自管 marked 初始化时用，避免覆盖行号 Renderer） */
            waitForMermaid: waitForMermaid,
            wrapMermaidChartHtml: wrapMermaidChartHtml,
            renderMarkdownToHtml: renderMarkdownToHtml,
            reinitializeMermaid: reinitializeMermaid
        };
    }

    global.MarkdownRenderCore = {
        create: create,
        wrapMermaidChartHtml: wrapMermaidChartHtml
    };
})(typeof window !== 'undefined' ? window : globalThis);
