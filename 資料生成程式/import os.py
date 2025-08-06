import os
import json
import requests
import ssl
import re
from bs4 import BeautifulSoup
from datetime import datetime
from urllib.parse import urljoin, urlsplit
import time
from requests.adapters import HTTPAdapter
from urllib3.poolmanager import PoolManager

# --- 自訂 TLS/SSL 適配器以支援舊版伺服器 ---
class LegacyTLSAdapter(HTTPAdapter):
    def init_poolmanager(self, connections, maxsize, block=False, **pool_kwargs):
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.options |= getattr(ssl, "OP_LEGACY_SERVER_CONNECT", 0x4)
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        self.poolmanager = PoolManager(
            num_pools=connections,
            maxsize=maxsize,
            block=block,
            ssl_context=context,
            **pool_kwargs
        )

# --- 全域常數設定 ---
BASE_ROOT = r"C:\Users\weiwe\Desktop\legislative_ai_web"
BASE_STORAGE = os.path.join(BASE_ROOT, "storage")
JSON_BASE = os.path.join(BASE_STORAGE, "progress")
DOC_BASE = os.path.join(BASE_STORAGE, "doc")
BASE_URL = "https://lis.ly.gov.tw"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
}

# --- 建立並設定全域 Session 物件 ---
session = requests.Session()
session.mount('https://', LegacyTLSAdapter())
session.verify = False
requests.packages.urllib3.disable_warnings(requests.packages.urllib3.exceptions.InsecureRequestWarning)


def ensure_dir(path: str):
    """確保指定路徑的資料夾存在，若不存在則建立。"""
    os.makedirs(path, exist_ok=True)

def fetch_soup(url: str) -> BeautifulSoup | None:
    """抓取指定 URL 的網頁內容並解析成 BeautifulSoup 物件。"""
    try:
        r = session.get(url, headers=HEADERS, timeout=30)
        r.raise_for_status()
        r.encoding = "utf-8"
        return BeautifulSoup(r.text, "html.parser")
    except requests.exceptions.RequestException as e:
        print(f"抓取失敗：{url}, 錯誤：{e}")
        return None

def sanitize_filename(name: str) -> str:
    """將字串中的無效字元移除或替換，使其可用於檔名。"""
    sanitized_name = re.sub(r'[\\/*?:"<>|]', "", name)
    sanitized_name = re.sub(r'\s+', '_', sanitized_name)
    return sanitized_name

def fetch_proposal_number(detail_url: str) -> str | None:
    """從議案詳情頁抓取提案編號。"""
    print(f"    -> 正在訪問詳情頁抓取提案編號: {detail_url}")
    detail_soup = fetch_soup(detail_url)
    if not detail_soup: return None

    # 策略1：尋找 "提案編號" 的表格欄位
    label_td = detail_soup.find("td", string=lambda t: t and t.strip() == "提案編號")
    if label_td and (value_td := label_td.find_next_sibling("td")):
        if proposal_no := value_td.get_text(strip=True):
            print(f"    -> [策略1成功] 成功抓取到提案編號: {proposal_no}")
            return proposal_no

    # 策略2：使用正規表達式從頁面純文字中尋找
    page_text = detail_soup.get_text()
    match = re.search(r"提案編號\s*([\s\S]+?)\s*(?:法名稱|資料來源|系統號)", page_text)
    if match:
        proposal_no = match.group(1).strip()
        if proposal_no and len(proposal_no) < 100:
            print(f"    -> [策略2成功] 成功抓取到提案編號: {proposal_no}")
            return proposal_no

    print("    -> ❌ [所有策略失敗] 未能在此頁面找到提案編號。")
    return None

def parse_page_data(soup: BeautifulSoup, current_page_url: str) -> list:
    """解析列表頁，提取每筆議案的資訊。"""
    rows = soup.select("table tr")
    data = []
    if len(rows) <= 1: return data
    
    for row in rows[1:]:
        cols = row.find_all("td")
        if len(cols) < 7: continue
        
        name = cols[2].get_text(strip=True)
        proposer = cols[3].get_text(strip=True)
        full_progress_text = cols[4].get_text(strip=True)
        
        date_txt = ""
        if progress_parts := full_progress_text.split(' ', 1):
            date_txt = progress_parts[0]
            
        doc_links = []
        if doc_icon_img := cols[6].find("img", src="/billtp/images/doc_icon.png"):
            if doc_link_tag := doc_icon_img.find_parent("a"):
                if href := doc_link_tag.get("href"):
                    doc_links.append(urljoin(BASE_URL, href))
        
        proposal_no = None
        if link_tag := cols[5].find("a"):
            if link_tag.find("img"): # 只找帶有圖片的連結
                if href := link_tag.get("href"):
                    detail_url = urljoin(current_page_url, href)
                    proposal_no = fetch_proposal_number(detail_url)
                    time.sleep(0.5)
        
        if not proposal_no:
             print(f"    -> 在 '{name}' 這一行找不到審議進度的圖片按鈕連結。")

        data.append({
            "date": date_txt,
            "bill_name": name,
            "proposer": proposer,
            "proposal_no": proposal_no,
            "progress": full_progress_text,
            "doc_links": doc_links
        })
    return data

def find_next_page_url(soup: BeautifulSoup, current_url: str) -> str | None:
    """在頁面中尋找「下一頁」的連結。"""
    if next_page_img := soup.find("img", src="/billtp/images/page_next.png"):
        if next_page_link := next_page_img.find_parent("a"):
            if href := next_page_link.get("href"):
                return urljoin(current_url, href)
    return None

def download_docs(item: dict, year: int, month: int):
    """下載與議案關聯的 DOC 檔案。"""
    doc_urls = item.get("doc_links", [])
    if not doc_urls: return
    
    folder = os.path.join(DOC_BASE, f"{year}_{month:02d}")
    ensure_dir(folder)

    base_name = f"{item.get('date', '未知日期')}_{item.get('proposer', '未知提案人')}_{item.get('bill_name', '未知法案')}"
    sanitized_base_name = sanitize_filename(base_name)
    fname = f"{sanitized_base_name}.doc"
    path = os.path.join(folder, fname)

    if os.path.exists(path):
        print(f"  檔案已存在，跳過：{fname}")
        return

    for url in doc_urls:
        try:
            print(f"  正在下載：{fname} 從 {url}")
            rr = session.get(url, headers=HEADERS, stream=True, timeout=60)
            rr.raise_for_status()
            with open(path, "wb") as f:
                for chunk in rr.iter_content(chunk_size=8192):
                    f.write(chunk)
            time.sleep(0.5)
            break # 假設一個議案只需要下載一個檔案
        except requests.exceptions.RequestException as e:
            print(f"  下載失敗：{url}, 錯誤：{e}")
        except Exception as e:
            print(f"  處理檔案時發生未知錯誤：{url}, 錯誤：{e}")

def crawl_category(cat_name: str, start_url: str, target_year: int, target_month: int):
    """
    爬取指定分類的議案，並採用更強健的翻頁邏輯。
    """
    print(f"--- 開始爬取分類：{cat_name} ---")
    all_filtered_items = []
    current_url = start_url
    
    # 目標月份的第一天，用於日期比較
    target_month_start_date = datetime(target_year, target_month, 1)

    while current_url:
        print(f"正在處理頁面：{current_url}")
        soup = fetch_soup(current_url)
        if not soup: break
        
        page_data = parse_page_data(soup, current_url)
        if not page_data:
            print("  -> 頁面無資料，可能已到末頁或解析失敗。")
            break

        items_found_on_this_page = 0
        # 先假設此頁資料都比目標月份舊，如果在迴圈中找到任何一筆資料是在目標月份或之後，就設為 False
        is_page_too_old = True

        for item in page_data:
            date_str = item["date"]
            try:
                if len(date_str) != 7 or not date_str.isdigit(): continue
                minguo_year = int(date_str[0:3])
                month = int(date_str[3:5])
                day = int(date_str[5:7])
                gregorian_year = minguo_year + 1911
                item_date = datetime(gregorian_year, month, day)

                # 只要有一筆資料的日期 >= 目標月份的第一天，就表示我們需要繼續翻頁
                if item_date >= target_month_start_date:
                    is_page_too_old = False

                # 檢查資料是否符合指定的年和月
                if gregorian_year == target_year and month == target_month:
                    all_filtered_items.append(item)
                    items_found_on_this_page += 1

            except (ValueError, TypeError):
                print(f"  -> 無法解析的日期格式，跳過：'{date_str}'")
                continue
        
        if items_found_on_this_page > 0:
            print(f"  ✅ 在此頁找到 {items_found_on_this_page} 筆符合 {target_year}/{target_month:02d} 的資料。")
        elif not is_page_too_old:
            print(f"  ℹ️  此頁面無符合 {target_year}/{target_month:02d} 的資料，但因日期較新，將繼續翻頁...")

        # 核心停止條件：如果此頁面所有資料都比目標月份還舊，就可以停止了
        if is_page_too_old:
            print(f"  🛑 此頁所有資料日期均早於 {target_year}/{target_month:02d}，停止在此分類下繼續翻頁。")
            break

        # 尋找下一頁
        current_url = find_next_page_url(soup, current_url)
        if current_url:
            print("  -> 找到下一頁，準備前往...")
            time.sleep(1)
        else:
            print("  -> 找不到下一頁，此分類爬取結束。")
    
    if not all_filtered_items:
        print(f"分類 {cat_name} 在 {target_year}/{target_month:02d} 沒有找到任何資料。")
        return

    json_folder = os.path.join(JSON_BASE, f"{target_year}_{target_month:02d}")
    ensure_dir(json_folder)
    json_fn = os.path.join(json_folder, f"{target_year}_{target_month:02d}_{cat_name}.json")
    print(f"寫入 JSON 檔案：{json_fn}")
    with open(json_fn, "w", encoding="utf-8") as jf:
        json.dump(all_filtered_items, jf, ensure_ascii=False, indent=4)
    
    print(f"開始下載 {cat_name} 分類的關聯檔案...")
    for item in all_filtered_items:
        download_docs(item, target_year, target_month)
    
    print(f"--- 分類 {cat_name} 爬取完成 ---\n")

def main():
    """主執行函式 - 改為互動式問答獲取年/月及所有URL"""
    
    # --- 步驟 1：互動式問答以獲取年月份 ---
    target_year = 0
    target_month = 0
    now = datetime.now()

    while True:
        try:
            year_input = input(f"➡️ 請輸入要抓取的年份 (西元，例如 {now.year}): ")
            if not year_input.strip():
                 print("⚠️ 年份不可為空，請重新輸入。")
                 continue
            target_year = int(year_input)
            if 1912 <= target_year <= now.year + 1:
                break
            else:
                print(f"⚠️ 年份似乎不正確，請輸入介於 1912 (民國元年) 至 {now.year + 1} 之間的年份。")
        except ValueError:
            print("❌ 輸入格式錯誤，請輸入西元年份的數字。")

    while True:
        try:
            month_input = input("➡️ 請輸入要抓取的月份 (1-12): ")
            if not month_input.strip():
                print("⚠️ 月份不可為空，請重新輸入。")
                continue
            target_month = int(month_input)
            if 1 <= target_month <= 12:
                break
            else:
                print("⚠️ 月份無效，請輸入 1 到 12 之間的數字。")
        except ValueError:
            print("❌ 輸入格式錯誤，請輸入月份的數字。")
    
    print(f"\n*** 您指定的目標年月為: {target_year}年 {target_month}月 ***")

    # --- 步驟 2：互動式問答以獲取各分類的網址 ---
    print("\n--- 現在，請提供最新的分類網址 ---")
    print("操作指引：請開啟瀏覽器進入立法院「議案進度查詢」頁面，")
    print("          然後分別點擊各個分類，將瀏覽器網址列的網址完整複製後，貼到下方的提示中。")

    category_urls = {}
    # 為了讓提示更清晰，將網站上的名稱也一併放入
    categories_to_ask = {
        "First_Reading": "一讀（付委審查）",
        "Committee": "委員會審議",
        "Second_Reading": "二讀會",
        "Third_Reading": "三讀會",
        "Other": "其他"
    }

    for key, name in categories_to_ask.items():
        while True:
            url_input = input(f"➡️ 請輸入「{name}」的網址: ")
            # 簡單驗證網址格式
            if url_input.strip().lower().startswith(('http://', 'https://')):
                category_urls[key] = url_input.strip()
                break
            else:
                print("❌ 網址格式似乎不正確，請確保以 http:// 或 https:// 開頭，然後再試一次。")

    print("\n✅ 感謝您提供網址，即將開始爬取...\n")
    
    # --- 步驟 3：開始執行爬取 ---
    ensure_dir(JSON_BASE)
    ensure_dir(DOC_BASE)
    
    for cname, url in category_urls.items():
        crawl_category(cname, url, target_year, target_month)
        
    print("✅ 所有分類爬取完成！")


if __name__ == "__main__":
    main()