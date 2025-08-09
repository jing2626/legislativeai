// static/compare_versions.js - 【最終功能完整版 - 已加入說明欄位鏈式比對】

document.addEventListener('DOMContentLoaded', () => {
    // --- 全域變數 ---
    let allBillsData = [];
    let legislatorPartyMap = new Map();

    // --- DOM 元素 ---
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const clearBtn = document.getElementById('clear-search-btn');
    const resultsPanel = document.getElementById('initial-search-results-panel');
    const resultsContainer = document.getElementById('initial-search-results');
    const resultsTitle = document.getElementById('initial-search-title');
    const comparisonInterface = document.getElementById('comparison-interface');
    const versionContainer = document.getElementById('version-container');
    const contentBody = document.getElementById('content-body');
    const contentTitle = document.getElementById('content-title');

    // --- 初始化及基礎函式 (此區塊無變更) ---
    async function initializePage() {
        showLoading('正在載入核心資料...');
        try {
            const [legResponse, billsResponse] = await Promise.all([
                fetch('/api/legislators.json'),
                fetch('/api/bills/all-range')
            ]);
            if (!legResponse.ok) throw new Error('無法載入立委資料');
            const legislatorData = await legResponse.json();
            legislatorData.jsonList.forEach(leg => legislatorPartyMap.set(normalizeName(leg.name), leg.party));
            if (!billsResponse.ok) throw new Error('無法載入法案資料');
            allBillsData = await billsResponse.json();
            showSearchPrompt();
        } catch (error) {
            console.error('初始化失敗:', error);
            showError('初始化失敗，請重新整理頁面。');
        }
    }
    function showLoading(message) {
        resultsPanel.style.display = 'block';
        comparisonInterface.style.display = 'none';
        resultsTitle.textContent = '載入中';
        resultsContainer.innerHTML = `<p class="loading-text">${message}</p>`;
    }
    function showError(message) {
        resultsContainer.innerHTML = `<p class="error-text">${message}</p>`;
    }
    function showSearchPrompt() {
        resultsPanel.style.display = 'none';
        comparisonInterface.style.display = 'none';
    }
    function performSearch() {
        const query = searchInput.value.toLowerCase().trim();
        if (!query) return;
        const filteredBills = allBillsData.filter(bill => {
            const billTitle = getBillTitle(bill).toLowerCase();
            const reason = (bill.reason || '').toLowerCase();
            return billTitle.includes(query) || reason.includes(query);
        });
        resultsPanel.style.display = 'block';
        comparisonInterface.style.display = 'none';
        resultsTitle.textContent = `搜尋 "${searchInput.value}" 的結果 (${filteredBills.length} 筆)`;
        if (filteredBills.length === 0) {
            resultsContainer.innerHTML = '<p class="error-text">找不到相關法案。</p>';
            return;
        }
        resultsContainer.innerHTML = '';
        filteredBills.forEach((bill, index) => {
            const card = document.createElement('div');
            card.className = 'bill-card';
            card.innerHTML = `<h4>${getBillTitle(bill)}</h4><p class="meta">${(bill.proposers || []).join(', ')}</p>`;
            card.addEventListener('click', () => selectBaseBill(bill));
            resultsContainer.appendChild(card);
            setTimeout(() => card.classList.add('slide-in'), 50 + (index * 50));
        });
    }
    function selectBaseBill(baseBill) {
        resultsPanel.style.display = 'none';
        comparisonInterface.style.display = 'block';
        versionContainer.innerHTML = '<p class="loading-text">正在分析同名法案...</p>';
        contentBody.innerHTML = '<p class="loading-text">請從左側選擇一個或多個版本進行查看</p>';
        const baseTitle = normalizeBillTitle(baseBill);
        const sameNameBills = allBillsData.filter(bill => normalizeBillTitle(bill) === baseTitle);
        const billsByProposer = groupBillsByProposer(sameNameBills);
        const finalVersions = getLatestVersionPerProposer(billsByProposer);
        renderVersionList(finalVersions, baseTitle);
    }
    function groupBillsByProposer(bills) {
        const proposerGroups = { '行政院': [], '司法院': [], '中國國民黨': [], '民主進步黨': [], '台灣民眾黨': [] };
        bills.forEach(bill => {
            const proposers = bill.proposers || [];
            if (proposers.length === 0) return;
            let mainProposer = null;
            const firstProposer = proposers[0].trim();
            if (proposerGroups.hasOwnProperty(firstProposer)) {
                mainProposer = firstProposer;
            } else {
                for (const proposer of proposers) {
                    const party = legislatorPartyMap.get(normalizeName(proposer));
                    if (party && party !== '無黨籍') {
                        mainProposer = party;
                        break;
                    }
                }
            }
            if (mainProposer && proposerGroups[mainProposer]) {
                proposerGroups[mainProposer].push(bill);
            }
        });
        return proposerGroups;
    }
    function getLatestVersionPerProposer(proposerGroups) {
        const latestVersions = {};
        for (const proposer in proposerGroups) {
            const bills = proposerGroups[proposer];
            if (bills.length > 0) {
                bills.sort((a, b) => {
                    const dateA = a.source_file.split('_')[0];
                    const dateB = b.source_file.split('_')[0];
                    if (dateA !== dateB) return dateB.localeCompare(dateA);
                    const billNoA = parseInt(a.bill_no, 10) || 0;
                    const billNoB = parseInt(b.bill_no, 10) || 0;
                    return billNoB - billNoA;
                });
                latestVersions[proposer] = bills[0];
            }
        }
        return latestVersions;
    }
    function renderVersionList(versions, baseTitle) {
        versionContainer.innerHTML = '';
        contentTitle.textContent = `比較｜${baseTitle}`;
        const displayOrder = ['行政院', '司法院', '民主進步黨', '中國國民黨', '台灣民眾黨'];
        displayOrder.forEach(proposer => {
            if (versions[proposer]) {
                const bill = versions[proposer];
                const item = document.createElement('div');
                item.className = 'version-item';
                item.dataset.proposer = proposer;
                item.innerHTML = `<h4>${proposer} 版本</h4><p>提案人: ${bill.proposers.join(', ')}</p>`;
                item.addEventListener('click', () => {
                    item.classList.toggle('selected');
                    updateContentDisplay(versions);
                });
                versionContainer.appendChild(item);
            }
        });
        if (Object.keys(versions).length === 0) {
            versionContainer.innerHTML = '<p class="error-text">找不到符合條件的提案版本。</p>';
        }
    }

    // --- 內容顯示與比較邏輯 ---
    function updateContentDisplay(allVersions) {
        const selectedItems = versionContainer.querySelectorAll('.version-item.selected');
        if (selectedItems.length === 0) {
            contentBody.innerHTML = '<p class="loading-text">請從左側選擇一個或多個版本進行查看</p>';
            return;
        }
        const billsToCompare = Array.from(selectedItems).map(item => allVersions[item.dataset.proposer]);
        if (billsToCompare.length === 1) {
            displaySingleBill(billsToCompare[0]);
        } else {
            displayComparisonTable(billsToCompare);
        }
    }

    function displaySingleBill(bill) {
        let html = `<h3>${getBillTitle(bill)}</h3><p><strong>提案人:</strong> ${bill.proposers.join(', ')}</p><h4>案由</h4><p>${String(bill.reason || '無').replace(/\n/g, '<br>')}</p><hr>`;
        if (bill.comparison_table && bill.comparison_table.length > 0) {
            bill.comparison_table.forEach(item => {
                const title = extractArticleTitle(item.modified_text) || extractArticleTitle(item.current_text) || '條文';
                html += `<h4>${title}</h4><p><strong>修正條文:</strong><br>${String(item.modified_text || '無').replace(/\n/g, '<br>')}</p><p><strong>現行條文:</strong><br>${String(item.current_text || '無').replace(/\n/g, '<br>')}</p><p><strong>說明:</strong><br>${String(item.explanation || '無').replace(/\n/g, '<br>')}</p><hr>`;
            });
        } else {
            html += '<p>無條文對照表。</p>';
        }
        contentBody.innerHTML = html;
    }

    function displayComparisonTable(bills) {
        const billArticleMaps = bills.map(bill => {
            const map = new Map();
            (bill.comparison_table || []).forEach(article => {
                const title = extractArticleTitle(article.modified_text) || extractArticleTitle(article.current_text);
                if (title) map.set(title, article);
            });
            return map;
        });
        const allTitles = new Set();
        billArticleMaps.forEach(map => map.forEach((_, title) => allTitles.add(title)));
        if (allTitles.size === 0) {
            contentBody.innerHTML = '<p class="error-text">選定的版本中沒有可供比較的條文內容。</p>';
            return;
        }
        const sortedTitles = sortArticleTitles(Array.from(allTitles));
        
        let accordionHTML = '<div class="comparison-accordion-container">';
        sortedTitles.forEach(title => {
            let tableContentHTML;
            if (window.matchMedia('(max-width: 768px)').matches) {
                tableContentHTML = createMobileComparisonTable(bills, title, billArticleMaps);
            } else {
                tableContentHTML = createDesktopComparisonTable(bills, title, billArticleMaps);
            }
            
            const hasDiff = tableContentHTML.includes('class="diff-added"');
            const headerClass = `accordion-header ${hasDiff ? 'has-difference' : ''}`;

            accordionHTML += `<div class="accordion-item"><button class="${headerClass}">${title}</button><div class="accordion-panel"><div class="accordion-content">${tableContentHTML}</div></div></div>`;
        });
        accordionHTML += '</div>';
        contentBody.innerHTML = accordionHTML;
        setupComparisonAccordion();
    }

    function createDesktopComparisonTable(bills, articleTitle, billArticleMaps) {
        let tableHTML = '<table class="comparison-view-table">';
        tableHTML += '<thead><tr><th>項目</th><th>現行版本</th>';
        bills.forEach(bill => {
            const proposerName = (bill.proposers && bill.proposers.length > 0) ? bill.proposers[0] : '';
            const headerTitle = ['行政院', '司法院'].includes(proposerName) ? proposerName : (legislatorPartyMap.get(normalizeName(proposerName)) || '未知黨派');
            tableHTML += `<th>${headerTitle} 版本</th>`;
        });
        tableHTML += '</tr></thead><tbody>';
        const currentTextArticle = bills.map((b, i) => billArticleMaps[i].get(articleTitle)).find(art => art?.current_text);
        const currentText = currentTextArticle ? currentTextArticle.current_text : '無';
        const firstBillArticle = billArticleMaps[0].get(articleTitle);
        const firstBillText = firstBillArticle ? (firstBillArticle.modified_text || '') : '';
        tableHTML += `<tr><td><strong>條文內容</strong></td><td>${String(currentText).replace(/\n/g, '<br>')}</td>`;
        bills.forEach((bill, index) => {
            const article = billArticleMaps[index].get(articleTitle);
            const proposedText = article ? (article.modified_text || '') : '此版本無相關條文';
            const diffHTML = currentText !== '無' ? generateDiffHTML(currentText, proposedText) : generateDiffHTML(firstBillText, proposedText);
            tableHTML += `<td>${diffHTML}</td>`;
        });
        tableHTML += '</tr>';

        // --- 【修改】說明欄位鏈式比對 ---
        tableHTML += '<tr><td><strong>說明</strong></td><td>--</td>';
        bills.forEach((bill, index) => {
            const currentArticle = billArticleMaps[index].get(articleTitle);
            const currentExplanation = currentArticle ? (currentArticle.explanation || '無') : '--';
            
            let diffExplanationHTML;
            if (index === 0) {
                // 第一個版本直接顯示，不做比對
                diffExplanationHTML = String(currentExplanation).replace(/\n/g, '<br>');
            } else {
                // 後續版本與前一個版本進行比對
                const previousArticle = billArticleMaps[index - 1].get(articleTitle);
                const previousExplanation = previousArticle ? (previousArticle.explanation || '') : '';
                diffExplanationHTML = generateDiffHTML(previousExplanation, currentExplanation);
            }
            tableHTML += `<td>${diffExplanationHTML}</td>`;
        });
        tableHTML += '</tr></tbody></table>';
        return tableHTML;
    }

    function createMobileComparisonTable(bills, articleTitle, billArticleMaps) {
        let tableHTML = '<table class="comparison-view-table">';
        tableHTML += '<thead><tr><th>提案版本</th><th>條文內容</th><th>說明</th></tr></thead>';
        tableHTML += '<tbody>';
        
        const currentTextArticle = bills.map((b, i) => billArticleMaps[i].get(articleTitle)).find(art => art?.current_text);
        const currentText = currentTextArticle ? currentTextArticle.current_text : '無';
        tableHTML += `<tr><td><strong>現行版本</strong></td><td>${String(currentText).replace(/\n/g, '<br>')}</td><td>--</td></tr>`;

        bills.forEach((bill, index) => {
            const proposerName = (bill.proposers && bill.proposers.length > 0) ? bill.proposers[0] : '';
            const headerTitle = ['行政院', '司法院'].includes(proposerName) ? proposerName : (legislatorPartyMap.get(normalizeName(proposerName)) || '未知黨派');
            const article = billArticleMaps[index].get(articleTitle);
            const proposedText = article ? (article.modified_text || '') : '此版本無相關條文';
            
            const diffContentHTML = generateDiffHTML(currentText, proposedText);
            
            // --- 【修改】說明欄位鏈式比對 ---
            const currentExplanation = article ? (article.explanation || '無') : '--';
            let diffExplanationHTML;
            if (index === 0) {
                diffExplanationHTML = String(currentExplanation).replace(/\n/g, '<br>');
            } else {
                const previousArticle = billArticleMaps[index - 1].get(articleTitle);
                const previousExplanation = previousArticle ? (previousArticle.explanation || '') : '';
                diffExplanationHTML = generateDiffHTML(previousExplanation, currentExplanation);
            }

            tableHTML += `<tr><td><strong>${headerTitle} 版本</strong></td><td>${diffContentHTML}</td><td>${diffExplanationHTML}</td></tr>`;
        });
        tableHTML += '</tbody></table>';
        return tableHTML;
    }
    
    function setupComparisonAccordion() {
        const accordionHeaders = contentBody.querySelectorAll('.accordion-header');
        accordionHeaders.forEach(header => {
            header.addEventListener('click', () => {
                const currentlyActiveHeader = contentBody.querySelector('.accordion-header.active');
                if (currentlyActiveHeader && currentlyActiveHeader !== header) {
                    currentlyActiveHeader.classList.remove('active');
                    currentlyActiveHeader.nextElementSibling.style.maxHeight = null;
                }
                header.classList.toggle('active');
                const panel = header.nextElementSibling;
                panel.style.maxHeight = panel.style.maxHeight ? null : panel.scrollHeight + "px";

                setTimeout(() => {
                    const allActivePanels = contentBody.querySelectorAll('.accordion-panel');
                    allActivePanels.forEach(p => {
                        if (p.style.maxHeight && p.style.maxHeight !== '0px') {
                            p.style.maxHeight = p.scrollHeight + "px";
                        }
                    });
                }, 400); 
            });
        });
    }

    // --- 核心輔助函式 (此區塊無變更) ---
    function generateDiffHTML(baseText, newText) {
        try {
            if (baseText === newText || !newText) return String(newText || '').replace(/\n/g, '<br>');
            if (!baseText || baseText === '無') return String(newText).replace(/\n/g, '<br>');
            if (typeof Diff === 'undefined' || !Diff.diffChars) {
                console.error('jsdiff (Diff.diffChars) not loaded!');
                return String(newText).replace(/\n/g, '<br>');
            }
            const diff = Diff.diffChars(baseText, newText);
            let result = '';
            diff.forEach(part => {
                if (part.added) {
                    result += `<span class="diff-added">${part.value.replace(/\n/g, '<br>')}</span>`;
                } else if (!part.removed) {
                    result += part.value.replace(/\n/g, '<br>');
                }
            });
            return result;
        } catch (error) {
            console.error("Error in generateDiffHTML:", error);
            return String(newText || '').replace(/\n/g, '<br>');
        }
    }
    function getBillTitle(bill) {
        return (bill && bill.source_file) ? bill.source_file.split('_').slice(2).join('_').replace('.docx', '') : '未知法案';
    }
    function normalizeBillTitle(bill) {
        const title = getBillTitle(bill);
        return title.replace(/修正|增訂|廢止|制定|部分條文|草案/g, '').replace(/第\S+條/g, '').trim();
    }
    function normalizeName(name) {
        return name ? name.replace(/[\s‧.-]/g, '') : '';
    }
    function extractArticleTitle(text) {
        if (!text) return null;
        const match = text.match(/^(第[一二三四五六七八九十百零]+(章|條(之[一二三四五六七八九十百零]+)?))/);
        return match ? match[0] : null;
    }
    function chineseToArabic(chineseNum) {
        const map = { '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
        const unitMap = { '十': 10, '百': 100, '千': 1000, '萬': 10000 };
        let result = 0;
        let section = 0;
        let number = 0;
        for (const char of chineseNum) {
            if (map.hasOwnProperty(char)) {
                number = map[char];
            } else {
                const unit = unitMap[char];
                if (unit === 10 && number === 0) number = 1;
                section += number * unit;
                number = 0;
                if (unit >= 10000) {
                    result += section;
                    section = 0;
                }
            }
        }
        result += section + number;
        return result;
    }
    function sortArticleTitles(titles) {
        return titles.sort((a, b) => {
            const parseTitle = (title) => {
                const mainMatch = title.match(/第([一二三四五六七八九十百零]+)(章|條)/);
                const subMatch = title.match(/之([一二三四五六七八九十百零]+)/);
                return {
                    mainNum: mainMatch ? chineseToArabic(mainMatch[1]) : 0,
                    subNum: subMatch ? chineseToArabic(subMatch[1]) : 0,
                    isChapter: title.includes('章')
                };
            };
            const parsedA = parseTitle(a);
            const parsedB = parseTitle(b);
            if (parsedA.isChapter !== parsedB.isChapter) return parsedB.isChapter - parsedA.isChapter;
            if (parsedA.mainNum !== parsedB.mainNum) return parsedA.mainNum - parsedB.mainNum;
            return parsedA.subNum - parsedB.subNum;
        });
    }
    function clearAll() {
        searchInput.value = '';
        resultsPanel.style.display = 'none';
        comparisonInterface.style.display = 'none';
        contentBody.innerHTML = '<p class="loading-text">請從左側選擇一個或多個版本進行查看</p>';
    }

    // --- 事件監聽器 ---
    searchBtn.addEventListener('click', performSearch);
    searchInput.addEventListener('keypress', e => { if (e.key === 'Enter') performSearch(); });
    clearBtn.addEventListener('click', clearAll);

    // --- 啟動 ---
    initializePage();
});