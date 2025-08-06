document.addEventListener('DOMContentLoaded', function() {
    
    // --- 功能一：頁內平滑滾動導航 ---
    const navLinks = document.querySelectorAll('.about-page-navigation a');
    navLinks.forEach(link => {
        link.addEventListener('click', function(event) {
            event.preventDefault(); 

            const targetId = this.getAttribute('href').substring(1);
            const targetElement = document.getElementById(targetId);

            if (targetElement) {
                window.scrollTo({
                    top: targetElement.offsetTop - 120, // 減去 header 的高度 + 一些間距
                    behavior: 'smooth'
                });
            }
        });
    });

    // --- ✨ 功能二：自動更新募款藍圖進度 (V2) ✨ ---
    function updateRoadmapProgress() {
        // 1. 獲取總募款金額的來源元素
        const totalFundingElement = document.getElementById('total-funding-amount');
        if (!totalFundingElement) return;

        // 2. 從元素中讀取文字，並轉換為純數字
        const totalFundingText = totalFundingElement.textContent;
        const totalFunding = parseInt(totalFundingText.replace(/[^0-9]/g, ''), 10);
        
        // 3. 獲取所有募款目標的區塊
        const roadmapGoals = document.querySelectorAll('.roadmap-goal');

        // 4. 遍歷每一個目標區塊，進行計算和更新
        roadmapGoals.forEach(goal => {
            // 4.1 從 data-goal 屬性讀取目標金額
            const targetAmount = parseInt(goal.dataset.goal, 10);
            if (!targetAmount) return; 

            // 4.2 找到需要更新的各個子元素
            const currentFundingEl = goal.querySelector('.current-funding');
            const percentageEl = goal.querySelector('.percentage');
            const progressBarEl = goal.querySelector('.progress-bar'); // ✨ 修改：獲取整個進度條容器
            const progressBarInnerEl = goal.querySelector('.progress-bar-inner');
            const progressBarLabelEl = goal.querySelector('.progress-bar-label'); // ✨ 新增：獲取進度條內的文字標籤

            // 4.3 進行計算
            const rawPercentage = (totalFunding / targetAmount) * 100;
            const displayPercentage = Math.min(rawPercentage, 100);

            // ✨ 修改：讓進度條寬度可以直接達到 100%
            const barWidth = displayPercentage;

            // 4.4 更新頁面上的內容
            if (currentFundingEl) {
                currentFundingEl.textContent = `NT$ ${totalFunding.toLocaleString('en-US')}`;
            }
            if (percentageEl) {
                percentageEl.textContent = `${displayPercentage.toFixed(0)}%`;
            }
            if (progressBarInnerEl) {
                progressBarInnerEl.style.width = `${barWidth}%`;
            }

            // ✨ 新增：判斷是否達成目標，並更新樣式與文字
            if (displayPercentage >= 100) {
                // 為進度條容器添加 'is-complete' class，用於CSS上色
                progressBarEl.classList.add('is-complete');
                // 如果找到文字標籤，就更新內容
                if(progressBarLabelEl) {
                    progressBarLabelEl.textContent = '目標達成！';
                }
            } else {
                // 如果未達成，確保移除 'is-complete' class
                progressBarEl.classList.remove('is-complete');
                // 並將文字恢復原樣
                if(progressBarLabelEl) {
                    progressBarLabelEl.textContent = '研發時間待訂';
                }
            }
        });
    }

    // 頁面載入後，立即執行一次更新函式
    updateRoadmapProgress();
});