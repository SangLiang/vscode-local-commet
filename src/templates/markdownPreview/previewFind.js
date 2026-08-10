/**
 * Markdown 预览页全文搜索（Ctrl+F）
 * 依赖页面已有 #previewFindBar 等 DOM；由 preview.js 在渲染后调用 restoreAfterRender。
 */
(function(global) {
    const FIND_MARK_CLASS = 'preview-find-match';
    const FIND_MARK_CURRENT_CLASS = 'preview-find-match-current';
    const FIND_SCROLL_DURATION_MS = 180;

    let previewArea = null;
    let previewFindBar = null;
    let previewFindInput = null;
    let previewFindStatus = null;
    let previewFindPrevBtn = null;
    let previewFindNextBtn = null;
    let previewFindCloseBtn = null;
    let initialized = false;

    const previewFindState = {
        active: false,
        query: '',
        currentIndex: 0,
        matches: []
    };
    let findScrollAnimationId = null;

    function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
    }

    function resolveFindScrollContext(element) {
        let node = element.parentElement;
        while (node) {
            if (node.scrollHeight > node.clientHeight + 1) {
                const overflowY = getComputedStyle(node).overflowY;
                if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
                    const containerRect = node.getBoundingClientRect();
                    return {
                        scrollEl: node,
                        containerHeight: containerRect.height,
                        getTargetScrollTop: function(elementRect) {
                            const relativeTop = elementRect.top - containerRect.top + node.scrollTop;
                            return relativeTop - containerRect.height / 2 + elementRect.height / 2;
                        }
                    };
                }
            }
            node = node.parentElement;
        }

        const scrollEl = document.scrollingElement || document.documentElement;
        return {
            scrollEl: scrollEl,
            containerHeight: window.innerHeight,
            getTargetScrollTop: function(elementRect) {
                const relativeTop = elementRect.top + scrollEl.scrollTop;
                return relativeTop - window.innerHeight / 2 + elementRect.height / 2;
            }
        };
    }

    function smoothScrollToFindMatch(element) {
        if (!element) {
            return;
        }

        if (findScrollAnimationId !== null) {
            cancelAnimationFrame(findScrollAnimationId);
            findScrollAnimationId = null;
        }

        const scrollContext = resolveFindScrollContext(element);
        const scrollEl = scrollContext.scrollEl;
        const elementRect = element.getBoundingClientRect();
        const targetTop = scrollContext.getTargetScrollTop(elementRect);
        const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
        const clampedTarget = Math.max(0, Math.min(targetTop, maxScroll));
        const startTop = scrollEl.scrollTop;
        const distance = clampedTarget - startTop;

        if (Math.abs(distance) < 1) {
            return;
        }

        const startTime = performance.now();

        function step(now) {
            const progress = Math.min((now - startTime) / FIND_SCROLL_DURATION_MS, 1);
            scrollEl.scrollTop = startTop + distance * easeOutCubic(progress);
            if (progress < 1) {
                findScrollAnimationId = requestAnimationFrame(step);
            } else {
                findScrollAnimationId = null;
            }
        }

        findScrollAnimationId = requestAnimationFrame(step);
    }

    function isFindExcludedNode(node) {
        const parent = node.parentElement;
        if (!parent) {
            return true;
        }
        return !!parent.closest(
            '.preview-find-bar, .mermaid-controls, .export-actions, script, style, noscript'
        );
    }

    function clearFindHighlights() {
        if (!previewArea) {
            return;
        }
        const marks = previewArea.querySelectorAll('mark.' + FIND_MARK_CLASS);
        marks.forEach(function(mark) {
            const textNode = document.createTextNode(mark.textContent);
            mark.parentNode.replaceChild(textNode, mark);
        });
        previewArea.normalize();
        previewFindState.matches = [];
        previewFindState.currentIndex = 0;
    }

    function escapeRegExp(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function collectPreviewTextNodes(root) {
        const nodes = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: function(node) {
                if (!node.nodeValue || !node.nodeValue.trim()) {
                    return NodeFilter.FILTER_REJECT;
                }
                return isFindExcludedNode(node)
                    ? NodeFilter.FILTER_REJECT
                    : NodeFilter.FILTER_ACCEPT;
            }
        });
        let node;
        while ((node = walker.nextNode())) {
            nodes.push(node);
        }
        return nodes;
    }

    function highlightPreviewMatches(query) {
        clearFindHighlights();
        if (!query) {
            updateFindStatus();
            updateFindNavButtons();
            return [];
        }

        const regex = new RegExp(escapeRegExp(query), 'gi');
        const textNodes = collectPreviewTextNodes(previewArea);
        const matches = [];

        textNodes.forEach(function(textNode) {
            const text = textNode.nodeValue;
            regex.lastIndex = 0;
            const parts = [];
            let lastIndex = 0;
            let match;

            while ((match = regex.exec(text)) !== null) {
                if (match[0] === '') {
                    regex.lastIndex += 1;
                    continue;
                }
                if (match.index > lastIndex) {
                    parts.push(document.createTextNode(text.slice(lastIndex, match.index)));
                }
                const mark = document.createElement('mark');
                mark.className = FIND_MARK_CLASS;
                mark.textContent = match[0];
                parts.push(mark);
                matches.push(mark);
                lastIndex = match.index + match[0].length;
            }

            if (parts.length > 0) {
                if (lastIndex < text.length) {
                    parts.push(document.createTextNode(text.slice(lastIndex)));
                }
                const parent = textNode.parentNode;
                parts.forEach(function(part) {
                    parent.insertBefore(part, textNode);
                });
                parent.removeChild(textNode);
            }
        });

        previewFindState.matches = matches;
        return matches;
    }

    function updateFindStatus() {
        if (!previewFindStatus) {
            return;
        }
        const total = previewFindState.matches.length;
        if (!previewFindState.query) {
            previewFindStatus.textContent = '';
            return;
        }
        if (total === 0) {
            previewFindStatus.textContent = '无结果';
            return;
        }
        const current = previewFindState.currentIndex + 1;
        previewFindStatus.textContent = current + '/' + total;
    }

    function updateFindNavButtons() {
        const hasMatches = previewFindState.matches.length > 0;
        if (previewFindPrevBtn) {
            previewFindPrevBtn.disabled = !hasMatches;
        }
        if (previewFindNextBtn) {
            previewFindNextBtn.disabled = !hasMatches;
        }
    }

    function scrollToFindMatch(index) {
        const matches = previewFindState.matches;
        if (!matches.length) {
            updateFindStatus();
            updateFindNavButtons();
            return;
        }

        const normalizedIndex = ((index % matches.length) + matches.length) % matches.length;
        previewFindState.currentIndex = normalizedIndex;

        matches.forEach(function(mark, i) {
            if (i === normalizedIndex) {
                mark.classList.add(FIND_MARK_CURRENT_CLASS);
            } else {
                mark.classList.remove(FIND_MARK_CURRENT_CLASS);
            }
        });

        const currentMark = matches[normalizedIndex];
        if (currentMark) {
            smoothScrollToFindMatch(currentMark);
        }

        updateFindStatus();
        updateFindNavButtons();
    }

    function runPreviewFind(query, preferredIndex) {
        previewFindState.query = query;
        const matches = highlightPreviewMatches(query);
        if (!matches.length) {
            updateFindStatus();
            updateFindNavButtons();
            return;
        }
        const index = typeof preferredIndex === 'number' ? preferredIndex : 0;
        scrollToFindMatch(index);
    }

    function showPreviewFindBar(selectAll) {
        if (!previewFindBar || !previewFindInput) {
            return;
        }
        previewFindBar.hidden = false;
        previewFindState.active = true;
        previewFindInput.focus();
        if (selectAll) {
            previewFindInput.select();
        }
        if (previewFindState.query) {
            runPreviewFind(previewFindState.query, previewFindState.currentIndex);
        }
    }

    function closePreviewFindBar() {
        if (!previewFindBar) {
            return;
        }
        previewFindBar.hidden = true;
        previewFindState.active = false;
        clearFindHighlights();
        updateFindStatus();
        updateFindNavButtons();
    }

    function goToNextFindMatch(step) {
        if (!previewFindState.matches.length) {
            if (previewFindState.query) {
                runPreviewFind(previewFindState.query, 0);
            }
            return;
        }
        scrollToFindMatch(previewFindState.currentIndex + step);
    }

    function restoreAfterRender() {
        if (!initialized || !previewFindState.active || !previewFindState.query) {
            return;
        }
        runPreviewFind(previewFindState.query, previewFindState.currentIndex);
    }

    function bindEvents() {
        if (previewFindInput) {
            previewFindInput.addEventListener('input', function() {
                runPreviewFind(previewFindInput.value, 0);
            });
            previewFindInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    goToNextFindMatch(e.shiftKey ? -1 : 1);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    closePreviewFindBar();
                }
            });
        }

        if (previewFindPrevBtn) {
            previewFindPrevBtn.addEventListener('click', function() {
                goToNextFindMatch(-1);
            });
        }

        if (previewFindNextBtn) {
            previewFindNextBtn.addEventListener('click', function() {
                goToNextFindMatch(1);
            });
        }

        if (previewFindCloseBtn) {
            previewFindCloseBtn.addEventListener('click', function() {
                closePreviewFindBar();
            });
        }

        document.addEventListener('keydown', function(e) {
            const isModF = (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f';
            if (isModF) {
                e.preventDefault();
                showPreviewFindBar(true);
                return;
            }
            if (!previewFindState.active) {
                return;
            }
            if (e.key === 'F3') {
                e.preventDefault();
                goToNextFindMatch(e.shiftKey ? -1 : 1);
            }
        });
    }

    /**
     * @param {{ previewArea: HTMLElement }} options
     */
    function init(options) {
        if (initialized) {
            return;
        }
        const opts = options || {};
        previewArea = opts.previewArea || document.getElementById('previewArea');
        if (!previewArea) {
            console.error('PreviewFind: previewArea 未找到');
            return;
        }

        previewFindBar = document.getElementById('previewFindBar');
        previewFindInput = document.getElementById('previewFindInput');
        previewFindStatus = document.getElementById('previewFindStatus');
        previewFindPrevBtn = document.getElementById('previewFindPrev');
        previewFindNextBtn = document.getElementById('previewFindNext');
        previewFindCloseBtn = document.getElementById('previewFindClose');

        bindEvents();
        initialized = true;
    }

    global.PreviewFind = {
        init: init,
        restoreAfterRender: restoreAfterRender
    };
})(typeof window !== 'undefined' ? window : this);
