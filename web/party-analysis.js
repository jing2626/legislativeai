// party-analysis.js - 政黨提案分析頁面的JavaScript

// --- 新增：將自訂格式文字轉換為 HTML 的函式 ---
function convertCustomMarkdownToHTML(text) {
    if (!text) return '';
    let html = text;
    
    // 1. 處理 **粗體文字** -> <strong>粗體文字</strong>
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    // 2. 處理 &&標題&& -> <h3>標題</h3>
    html = html.replace(/&&([^&\n]+)&&/g, '<h3>$1</h3>');

    // 3. 處理換行符號 -> <br>
    html = html.replace(/\n/g, '<br>');
    
    return html;
}

document.addEventListener('DOMContentLoaded', () => {
    // --- 全域變數 ---
    let availableMonths = [];
    let currentTimeRange = null;
    let partyChart = null;
    let currentPartyStats = null;
    let fullBillListForParty = [];
    let legislatorPartyMap = new Map(); // 新增：立委政黨對應表

    // DOM 元素
    const startMonthSelect = document.getElementById('start-month');
    const endMonthSelect = document.getElementById('end-month');
    const applyTimeRangeBtn = document.getElementById('apply-time-range');
    const resetToLatestBtn = document.getElementById('reset-to-latest');
    const currentTimeRangeDisplay = document.getElementById('current-time-range');
    
    const totalBillsSpan = document.getElementById('total-bills');
    const independentRateSpan = document.getElementById('independent-rate');
    const independentCountSpan = document.getElementById('independent-count');
    const independentRateDisplaySpan = document.getElementById('independent-rate-display');
    const viewIndependentBillsBtn = document.getElementById('view-independent-bills');
    
    const billListTitle = document.getElementById('bill-list-title');
    const billContainer = document.getElementById('bill-container');
    const paginationContainer = document.getElementById('pagination-container');
    
    const modalOverlay = document.getElementById('modal-overlay');
    const modalBody = document.getElementById('modal-body');
    const modalCloseBtn = document.getElementById('modal-close-btn');

    // --- 初始化函式 ---
    async function initializePage() {
        try {
            // 載入立委資料
            const legResponse = await fetch('/api/legislators.json');
            if (legResponse.ok) {
                const legislatorData = await legResponse.json();
                legislatorData.jsonList.forEach(leg => {
                    legislatorPartyMap.set(normalizeName(leg.name), leg.party);
                });
            }

            // 載入可用月份
            await loadAvailableMonths();
            
            // 預設載入最新3個月的資料
            await loadLatestThreeMonths();
            
        } catch (error) {
            console.error('初始化頁面時發生錯誤:', error);
            showError('載入頁面時發生錯誤');
        }
    }

    // --- 輔助函式 ---
    function normalizeName(name) {
        if (!name) return '';
        return name.replace(/[\s‧.-]/g, '');
    }

    function colorizeLegislatorNames(nameData) {
        if (!nameData || nameData.length === 0) return '無';
        const namesArray = nameData.flatMap(str => str.split(/\s{2,}/)).filter(Boolean);
        if (namesArray.length === 0) return '無';

        const partyClassMap = {
            '民主進步黨': 'party-dpp',
            '中國國民黨': 'party-kmt',
            '台灣民眾黨': 'party-tpp',
            '無黨籍': 'party-independent',
            'default': 'party-independent'
        };

        const coloredNames = namesArray.map(name => {
            const trimmedName = name.trim();
            if (!trimmedName) return '';
            const party = legislatorPartyMap.get(normalizeName(trimmedName)); 
            const cssClass = partyClassMap[party] || partyClassMap['default'];
            return `<span class="legislator-name ${cssClass}">${trimmedName}</span>`;
        });
        return coloredNames.join('、');
    }

    // --- AI分析手風琴功能 ---
    function createAiAnalysisAccordions(aiText) {
        if (!aiText) return '';
        const sections = [];
        const regex = /&&([^&\n]+)&&\s*([\s\S]*?)(?=&&|$)/g;

        let match;
        while ((match = regex.exec(aiText)) !== null) {
            sections.push({
                title: match[1].replace(/\(\d+\)/g, '').replace(/[&*:：]/g, '').trim(),
                content: match[2].trim()
            });
        }
        let html = '';
        const subHeadings = [
            "為什麼要改？", "改了什麼重點？", "可能會對民眾產生什麼影響？",
            "為什麼我們需要這部新法律？", "它主要在規範什麼？", "未來對民眾的生活可能有哪些影響？"
        ];
        const titlesToPrefix = ["條文差異比較", "修法理由總結", "白話文解說","立法重點摘要","增訂理由"];

        for (let i = 0; i < sections.length; i++) {
            const section = sections[i];
            let displayTitle = section.title;
            if (titlesToPrefix.includes(section.title)) {
                displayTitle = "AI " + section.title;
            }
            if (section.title === "白話文解說") {
                let nestedHtml = '';
                while (i + 1 < sections.length && subHeadings.includes(sections[i + 1].title)) {
                    i++;
                    const subSection = sections[i];
                    if (subSection.content) {
                        nestedHtml += `
                            <div class="accordion-item nested">
                                <button class="accordion-header">${subSection.title}</button>
                                <div class="accordion-panel">
                                    <div class="accordion-content">
                                        <p>${convertCustomMarkdownToHTML(subSection.content)}</p>
                                    </div>
                                </div>
                            </div>`;
                    }
                }
                if (nestedHtml) {
                    html += `
                        <div class="accordion-item">
                            <button class="accordion-header">${displayTitle}</button>
                            <div class="accordion-panel">
                                <div class="accordion-content">
                                    <div class="nested-accordion-container">
                                        ${nestedHtml}
                                    </div>
                                </div>
                            </div>
                        </div>`;
                }
            } 
            else if (subHeadings.includes(section.title) || section.title === "法案分類") {
                continue;
            }
            else {
                if (section.content) {
                    html += `
                        <div class="accordion-item">
                            <button class="accordion-header">${displayTitle}</button>
                            <div class="accordion-panel">
                                <div class="accordion-content">
                                    <p>${convertCustomMarkdownToHTML(section.content)}</p>
                                </div>
                            </div>
                        </div>`;
                }
            }
        }
        return html;
    }

    // --- 時間範圍相關函式 ---
    async function loadAvailableMonths() {
        try {
            const response = await fetch('/api/available-months');
            if (!response.ok) throw new Error('無法載入可用月份');
            
            availableMonths = await response.json();
            populateMonthSelects();
        } catch (error) {
            console.error('載入可用月份時發生錯誤:', error);
            startMonthSelect.innerHTML = '<option value="">載入失敗</option>';
            endMonthSelect.innerHTML = '<option value="">載入失敗</option>';
        }
    }

    function populateMonthSelects() {
        if (availableMonths.length === 0) {
            startMonthSelect.innerHTML = '<option value="">無可用資料</option>';
            endMonthSelect.innerHTML = '<option value="">無可用資料</option>';
            return;
        }

        const options = availableMonths.map(month => 
            `<option value="${month.year}-${month.month.toString().padStart(2, '0')}">${month.label}</option>`
        ).join('');

        startMonthSelect.innerHTML = options;
        endMonthSelect.innerHTML = options;

        // 預設選擇最新的月份作為結束月份，最新的第3個月作為開始月份
        if (availableMonths.length >= 3) {
            const latestMonth = availableMonths[0];
            const thirdLatestMonth = availableMonths[2];
            startMonthSelect.value = `${thirdLatestMonth.year}-${thirdLatestMonth.month.toString().padStart(2, '0')}`;
            endMonthSelect.value = `${latestMonth.year}-${latestMonth.month.toString().padStart(2, '0')}`;
        } else if (availableMonths.length > 0) {
            const latestMonth = availableMonths[0];
            const oldestMonth = availableMonths[availableMonths.length - 1];
            startMonthSelect.value = `${oldestMonth.year}-${oldestMonth.month.toString().padStart(2, '0')}`;
            endMonthSelect.value = `${latestMonth.year}-${latestMonth.month.toString().padStart(2, '0')}`;
        }
    }

    async function loadLatestThreeMonths() {
        try {
            // 載入政黨統計資料
            const response = await fetch('/api/party-stats');
            if (!response.ok) throw new Error('無法載入政黨統計資料');
            
            currentPartyStats = await response.json();
            
            // 更新顯示
            updateStatsDisplay();
            renderPartyChart();
            
            // 更新當前時間範圍顯示
            if (availableMonths.length >= 3) {
                const latest3 = availableMonths.slice(0, 3);
                const rangeText = `${latest3[2].label} 至 ${latest3[0].label}`;
                currentTimeRangeDisplay.textContent = `目前顯示：${rangeText}`;
                currentTimeRange = {
                    start: `${latest3[2].year}-${latest3[2].month.toString().padStart(2, '0')}`,
                    end: `${latest3[0].year}-${latest3[0].month.toString().padStart(2, '0')}`
                };
            } else {
                currentTimeRangeDisplay.textContent = '目前顯示：所有可用資料';
                currentTimeRange = null;
            }

        } catch (error) {
            console.error('載入最新3個月資料時發生錯誤:', error);
            showError('載入資料時發生錯誤');
        }
    }

    async function applyTimeRange() {
        const startMonth = startMonthSelect.value;
        const endMonth = endMonthSelect.value;

        if (!startMonth || !endMonth) {
            alert('請選擇開始和結束月份');
            return;
        }

        if (startMonth > endMonth) {
            alert('開始月份不能晚於結束月份');
            return;
        }

        try {
            // 載入指定範圍的政黨統計資料
            const response = await fetch(`/api/party-stats?start=${startMonth}&end=${endMonth}`);
            if (!response.ok) throw new Error('無法載入政黨統計資料');
            
            currentPartyStats = await response.json();
            
            // 更新顯示
            updateStatsDisplay();
            renderPartyChart();
            clearBillList();

            // 更新當前時間範圍顯示
            const startMonthObj = availableMonths.find(m => `${m.year}-${m.month.toString().padStart(2, '0')}` === startMonth);
            const endMonthObj = availableMonths.find(m => `${m.year}-${m.month.toString().padStart(2, '0')}` === endMonth);
            
            if (startMonthObj && endMonthObj) {
                currentTimeRangeDisplay.textContent = `目前顯示：${startMonthObj.label} 至 ${endMonthObj.label}`;
            } else {
                currentTimeRangeDisplay.textContent = `目前顯示：${startMonth} 至 ${endMonth}`;
            }
            
            currentTimeRange = { start: startMonth, end: endMonth };

        } catch (error) {
            console.error('套用時間範圍時發生錯誤:', error);
            alert('載入指定時間範圍的資料時發生錯誤');
        }
    }

    // --- 統計資料顯示 ---
    function updateStatsDisplay() {
        if (!currentPartyStats) return;
        
        totalBillsSpan.textContent = currentPartyStats.total_bills;
        
        const independentRate = (currentPartyStats.independent_participation_rate * 100).toFixed(1);
        independentRateSpan.textContent = `${independentRate}%`;
        
        const independentCount = currentPartyStats.party_counts['無黨籍'] || 0;
        independentCountSpan.textContent = independentCount;
        independentRateDisplaySpan.textContent = `${independentRate}%`;
    }

    // --- 圓餅圖渲染 ---
    function renderPartyChart() {
        if (!currentPartyStats) return;
        
        const ctx = document.getElementById('party-chart').getContext('2d');
        
        // 如果已有圖表，先銷毀
        if (partyChart) {
            partyChart.destroy();
        }
        
        // 準備圓餅圖資料（排除無黨籍）
        const partyData = [];
        const partyLabels = [];
        const partyColors = [];
        const partyTypes = [];
        
        const colorMap = {
            '中國國民黨': '#1f77b4',
            '民主進步黨': '#2ca02c',
            '台灣民眾黨': '#72e6e8ff',
            '中國國民黨+台灣民眾黨': '#3391e9ff',
            '中國國民黨+民主進步黨': '#b463d4ff',
            '民主進步黨+台灣民眾黨': '#3af6a8ff'
        };
        
        // 按照指定順序排列
        const orderedParties = [
            '中國國民黨',
            '中國國民黨+民主進步黨',
            '民主進步黨',
            '民主進步黨+台灣民眾黨',
            '台灣民眾黨',
            '中國國民黨+台灣民眾黨'
        ];
        
        for (const party of orderedParties) {
            const count = currentPartyStats.party_counts[party] || 0;
            if (count > 0) {
                partyData.push(count);
                partyLabels.push(party);
                partyColors.push(colorMap[party]);
                partyTypes.push(party);
            }
        }
        
        // 建立圓餅圖
        partyChart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: partyLabels,
                datasets: [{
                    data: partyData,
                    backgroundColor: partyColors,
                    borderColor: '#ffffff',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 20,
                            usePointStyle: true,
                            font: {
                                size: 12
                            }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = ((context.parsed / total) * 100).toFixed(1);
                                return `${context.label}: ${context.parsed}筆 (${percentage}%)`;
                            }
                        }
                    }
                },
                onClick: (event, elements) => {
                    if (elements.length > 0) {
                        const index = elements[0].index;
                        const partyType = partyTypes[index];
                        loadPartyBills(partyType);

                        // --- ✨ 新增的捲動邏輯開始 ✨ ---
                        // 判斷是否為手機尺寸
                        if (window.matchMedia('(max-width: 768px)').matches) {
                            // 找到法案列表的標題作為捲動目標
                            const billListTitle = document.getElementById('bill-list-title');

                            if (billListTitle) {
                                // 平滑地捲動到目標位置
                                billListTitle.scrollIntoView({ behavior: 'smooth' });
                            }
                        }
                        // --- ✨ 新增的捲動邏輯結束 ✨ ---
                    }
                }
            }
        });
    }

    // --- 法案列表相關函式 ---
    async function loadPartyBills(partyType) {
        try {
            billListTitle.textContent = `載入中... (${partyType})`;
            billContainer.innerHTML = '<p class="loading-text">載入中...</p>';
            paginationContainer.innerHTML = '';
            
            let apiUrl = `/api/party-bills?party=${encodeURIComponent(partyType)}`;
            if (currentTimeRange) {
                apiUrl += `&start=${currentTimeRange.start}&end=${currentTimeRange.end}`;
            }
            
            const response = await fetch(apiUrl);
            if (!response.ok) throw new Error('無法載入法案資料');
            
            const bills = await response.json();
            fullBillListForParty = bills;
            
            billListTitle.textContent = `${partyType} (${bills.length}筆)`;
            renderBillCards(bills, 1);
            renderPagination(bills.length);
            
        } catch (error) {
            console.error('載入政黨法案時發生錯誤:', error);
            billContainer.innerHTML = '<p class="error-text">載入法案時發生錯誤</p>';
        }
    }

    function renderBillCards(bills, page = 1, billsPerPage = 10) {
        if (!billContainer) return;
        billContainer.innerHTML = '';
        
        const start = (page - 1) * billsPerPage;
        const end = start + billsPerPage;
        const paginatedBills = bills.slice(start, end);

        paginatedBills.forEach((bill, index) => {
            const card = document.createElement('div');
            card.className = 'bill-card';
            
            const billTitle = bill.source_file.split('_').slice(2).join('_').replace('.docx', '');
            
            // 使用與主頁相同的卡片HTML結構，包含立委名字的政黨色彩
            card.innerHTML = `
                <h4>${billTitle}</h4>
                <p class="meta">${colorizeLegislatorNames(bill.proposers)}</p>
                <p class="bill-progress"><strong>進度：</strong> ${bill.progress || '未提供'}</p>
            `;

            card.addEventListener('click', () => showModal(bill));
            
            billContainer.appendChild(card);

            setTimeout(() => {
                card.classList.add('slide-in');
            }, 50 + (index * 50));
        });
    }

    function renderPagination(totalBills, billsPerPage = 10) {
        if (!paginationContainer) return;
        paginationContainer.innerHTML = '';
        if (totalBills <= billsPerPage) return;
        
        const pageCount = Math.ceil(totalBills / billsPerPage);
        for (let i = 1; i <= pageCount; i++) {
            const btn = document.createElement('button');
            btn.textContent = i;
            if (i === 1) btn.classList.add('active');
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('#pagination-container button').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                renderBillCards(fullBillListForParty, i, billsPerPage);
            });
            paginationContainer.appendChild(btn);
        }
    }

    function clearBillList() {
        billListTitle.textContent = '📋 請點擊圓餅圖選擇政黨';
        billContainer.innerHTML = '';
        paginationContainer.innerHTML = '';
        fullBillListForParty = [];
    }

    // --- Modal 相關函式 ---
    function showModal(bill) {
        if (!modalBody || !modalOverlay) return;

        const billTitle = bill.source_file.split('_').slice(2).join('_').replace('.docx', '');

        const createComparisonTableHTML = (tableData) => {
            if (!tableData || tableData.length === 0) return '<p>此為新法案或無條文對照。</p>';
            let tableHTML = '<div class="comparison-table">';
            
            tableData.forEach(item => {
                const modifiedText = item.modified_text ? item.modified_text.replace(/\n/g, '<br>') : '無';
                const currentText = item.current_text ? item.current_text.replace(/\n/g, '<br>') : '無';
                const explanation = item.explanation ? item.explanation.replace(/\n/g, '<br>') : '無';
                
                tableHTML += `
                    <div class="comparison-item"> 
                        <div class="comparison-row">
                            <div class="comparison-col"><h4>修正條文</h4><p>${modifiedText}</p></div>
                            <div class="comparison-col"><h4>現行條文</h4><p>${currentText}</p></div>
                        </div>
                        <div class="comparison-row explanation-row">
                            <div class="comparison-col explanation"><h4>說明</h4><p>${explanation}</p></div>
                        </div>
                    </div>`;
            });

            tableHTML += '</div>';
            return tableHTML;
        };
        
        modalBody.innerHTML = `
            <h2>${billTitle}</h2>
            <div class="detail-section">
                <h3>提案資訊</h3>
                <p><strong>議案編號：</strong>${bill.bill_no || '無'}</p>
                <p><strong>進度：</strong>${bill.progress || '未提供'}</p>
                <p><strong>提案人：</strong>${colorizeLegislatorNames(bill.proposers)}</p>
                <p><strong>連署人：</strong>${colorizeLegislatorNames(bill.cosigners)}</p>
            </div>
            <div class="detail-section">
                <h3>案由</h3>
                <p>${convertCustomMarkdownToHTML(bill.reason)}</p>
            </div>
            <div class="accordion-item">
                <button class="accordion-header">條文差異比較</button>
                <div class="accordion-panel">
                    <div class="accordion-content">
                        ${createComparisonTableHTML(bill.comparison_table)}
                    </div>
                </div>
            </div>
            ${createAiAnalysisAccordions(bill.ai_analysis)}
        `;
        
        // --- 手風琴功能 ---
        modalBody.querySelectorAll('.accordion-header').forEach(button => {
            button.addEventListener('click', () => {
                const panel = button.nextElementSibling;
                if (!panel || !panel.classList.contains('accordion-panel')) return;

                const onTransitionEnd = () => {
                    let parent = panel.closest('.accordion-panel');
                    while (parent) {
                        if (parent.style.maxHeight && parent.style.maxHeight !== '0px') {
                            parent.style.maxHeight = parent.scrollHeight + 'px';
                        }
                        parent = parent.parentElement.closest('.accordion-panel');
                    }
                    panel.removeEventListener('transitionend', onTransitionEnd);
                };

                panel.addEventListener('transitionend', onTransitionEnd);
                
                const isActive = button.classList.toggle('active');
                panel.style.maxHeight = isActive ? panel.scrollHeight + 'px' : null;
            });
        });
        
        modalOverlay.classList.remove('hidden');
    }

    function hideModal() {
        modalOverlay.classList.add('hidden');
    }

    function showError(message) {
        billContainer.innerHTML = `<p class="error-text">${message}</p>`;
    }

    // --- 事件監聽器 ---
    applyTimeRangeBtn.addEventListener('click', applyTimeRange);
    resetToLatestBtn.addEventListener('click', loadLatestThreeMonths);
    viewIndependentBillsBtn.addEventListener('click', () => loadPartyBills('無黨籍'));
    modalCloseBtn.addEventListener('click', hideModal);
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) hideModal();
    });

    // --- 初始化頁面 ---
    initializePage();
});

