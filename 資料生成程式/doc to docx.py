# -*- coding: utf-8 -*-
"""
DOC to DOCX 格式轉換器 (Microsoft Word 版) - 遞迴版本

功能：
1. 依賴系統中已安裝的 Microsoft Word。
2. 使用 pywin32 套件，自動化控制 Word。
3. 可遞迴地搜尋指定來源資料夾（及其所有子資料夾）中的 .doc 檔案。
4. 將找到的 .doc 檔案轉換為 .docx 格式，並在指定的輸出資料夾中，
   維持與來源資料夾相同的子資料夾結構。
"""
import os
import win32com.client as win32

# --- 1. 設定輸入與輸出資料夾 ---
# 請將這裡的路徑修改為您實際的資料夾路徑
# input_dir 是您存放 .doc 檔案的根目錄
input_dir = r"C:\Users\weiwe\Desktop\legislative_ai_web\storage\doc"
# output_dir 是您希望存放轉換後 .docx 檔案的根目錄
# 程式會自動在此路徑下建立與來源對應的子資料夾 (例如 2025_08)
output_dir = r"C:\Users\weiwe\Desktop\legislative_ai_web\storage\docx"

# 檢查來源資料夾是否存在
if not os.path.exists(input_dir):
    print(f"❌ 錯誤：找不到來源資料夾 '{input_dir}'。請檢查路徑是否正確。")
    exit()
# 確保輸出根目錄存在，如果不存在就建立它
os.makedirs(output_dir, exist_ok=True)

# --- 2. 啟動 Microsoft Word 應用程式 ---
word = None
try:
    print("--- 正在啟動 Microsoft Word 應用程式 (背景執行)... ---")
    word = win32.Dispatch("Word.Application")
    word.Visible = False
    print("✅ Word 應用程式已在背景成功啟動。")

    # --- 3. 使用 os.walk 遞迴遍歷並轉換檔案 ---
    print(f"--- 開始掃描 '{input_dir}' 及其所有子資料夾... ---")

    # 首先，收集所有需要處理的 .doc 檔案，以便計算總數和進度
    doc_files_to_process = []
    for dirpath, _, filenames in os.walk(input_dir):
        for filename in filenames:
            # 確保檔案是 .doc 且不是 Word 臨時檔
            if filename.lower().endswith('.doc') and not filename.startswith('~$'):
                doc_files_to_process.append(os.path.join(dirpath, filename))

    total_files = len(doc_files_to_process)
    if total_files == 0:
        print("ℹ️  在來源資料夾中沒有找到任何 .doc 檔案。")
    else:
        print(f"🔍 總共找到 {total_files} 個 .doc 檔案待處理。")

    # 依序處理收集到的檔案
    for index, input_path in enumerate(doc_files_to_process):
        # 從完整路徑中取得檔案名稱
        filename = os.path.basename(input_path)
        
        print("-" * 50)
        print(f"處理進度: {index + 1} / {total_files}")
        print(f"正在轉換檔案: {input_path}")

        # --- 建立對應的輸出路徑 ---
        # 1. 取得檔案相對於來源根目錄的「相對路徑」
        #    例如 C:\...\doc\2025_08\file.doc -> 2025_08
        relative_path = os.path.relpath(os.path.dirname(input_path), input_dir)
        
        # 2. 在輸出目錄下，建立一個與來源結構相同的子資料夾
        #    例如 C:\...\docx\2025_08
        current_output_dir = os.path.join(output_dir, relative_path)
        os.makedirs(current_output_dir, exist_ok=True)

        # 3. 組合最終的輸出檔案完整路徑
        output_filename = os.path.splitext(filename)[0] + '.docx'
        output_path = os.path.join(current_output_dir, output_filename)

        if os.path.exists(output_path):
            print("ℹ️  目標檔案已存在，跳過轉換。")
            continue
        
        doc = None
        try:
            # 開啟 .doc 檔案
            doc = word.Documents.Open(input_path)
            
            # 另存為 .docx 格式 (FileFormat=16 代表 .docx)
            doc.SaveAs2(output_path, FileFormat=16)
            print(f"✅ 成功轉換並儲存至: {output_path}")

        except Exception as e:
            print(f"❌ 轉換檔案時發生錯誤: {filename}")
            print(f"   錯誤原因: {e}")
        finally:
            # 無論成功或失敗，都關閉已開啟的文件，避免鎖定
            if doc:
                doc.Close(False) # False 代表不儲存變更

except Exception as e:
    print("\n❌ 啟動 Word 或處理過程中發生嚴重錯誤。")
    print(f"   請確認您的電腦已安裝 Microsoft Word。")
    print(f"   錯誤原因: {e}")
finally:
    # 確保無論如何，最後都關閉 Word 應用程式以釋放資源
    if word:
        word.Quit()
        print("\n--- 已關閉 Word 應用程式 ---")

print("\n🎉🎉🎉 所有檔案轉換任務已完成！ 🎉🎉🎉")