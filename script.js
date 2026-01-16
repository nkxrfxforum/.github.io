function decompressBinaryData(compressed, width, height) {
    const pixelCount = width * height;
    const decompressed = new Uint8Array(pixelCount * 4);

    for (let i = 0; i < pixelCount; i++) {
        // 計算該像素在壓縮數據中的位置
        const byteIndex = Math.floor(i / 8);  // 第幾個位元組
        const bitIndex = 7 - (i % 8);         // 該位元組中的第幾位
        const bit = (compressed[byteIndex] >> bitIndex) & 1;
        const pixelValue = bit === 1 ? 255 : 0;
        const offset = i * 4;
        decompressed[offset] = pixelValue;     // R
        decompressed[offset + 1] = pixelValue; // G
        decompressed[offset + 2] = pixelValue; // B
        decompressed[offset + 3] = 255;        // A
    }
    return decompressed;
}
function decodeTemplateImage(imgObj) {
    const compressedData = new Uint8Array(atob(imgObj.data).split('').map(c => c.charCodeAt(0)));
    const decompressedData = decompressBinaryData(compressedData, imgObj.width, imgObj.height);
    const gray = new Uint8Array(imgObj.width * imgObj.height);
    for (let i = 0; i < gray.length; i++) {
        gray[i] = decompressedData[i * 4]; // 取 R 通道值
    }
    return gray;
}
function buildGrayMap(templateGroup, addPngSuffix = false) {
    const grayMap = {};
    for (const [key, imgObj] of Object.entries(templateGroup)) {
        const mapKey = addPngSuffix ? key + '.png' : key;
        grayMap[mapKey] = decodeTemplateImage(imgObj);
    }
    return grayMap;
}

// getGrayROI, getGrayROINormal, computePixelSimilarity, computeSupAffixNameSimilarity, computeSSIM
function getGrayROI(imageData, threshold = CONFIG.BINARIZE_THRESHOLD) {
    const { data, width, height } = imageData;
    const pixelCount = width * height;
    const gray = new Uint8Array(pixelCount);

    // 使用單次循環優化效能
    for (let i = 0, j = 0; j < pixelCount; i += 4, j++) {
        // 計算灰度值（亮度公式）
        const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        // 反向二值化：亮度 > 閾值 → 0（白色），否則 → 255（黑色）
        gray[j] = luminance > threshold ? 0 : 255;
    }
    return gray;
}
function getGrayROINormal(imageData, threshold = CONFIG.BINARIZE_THRESHOLD) {
    const { data, width, height } = imageData;
    const pixelCount = width * height;
    const gray = new Uint8Array(pixelCount);

    // 使用單次循環優化效能
    for (let i = 0, j = 0; j < pixelCount; i += 4, j++) {
        // 計算灰度值（亮度公式）
        const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        // 正常二值化：亮度 > 閾值 → 255（白色），否則 → 0（黑色）
        gray[j] = luminance > threshold ? 255 : 0;
    }
    return gray;
}

function computePixelSimilarity(roiGray, candidateGray) {
    if (roiGray.length !== candidateGray.length) return 0;

    let matchCount = 0;
    let blackPixelCount = 0;

    // 遍歷所有像素，僅統計黑色像素的匹配情況
    for (let i = 0; i < roiGray.length; i++) {
        if (roiGray[i] === 255) {  // ROI 的黑色像素
            blackPixelCount++;
            if (candidateGray[i] === 255) {  // 模板對應位置也是黑色
                matchCount++;
            }
        }
    }

    // 避免除以零
    if (blackPixelCount === 0) return 0;
    return matchCount / blackPixelCount;
}
function computeSupAffixNameSimilarity(roiGray, candidateGray) {
    if (roiGray.length !== candidateGray.length) return 0;

    let matchCount = 0;
    let mismatchCount = 0;
    let blackPixelCount = 0;

    // 遍歷所有像素，統計匹配與不匹配情況
    for (let i = 0; i < roiGray.length; i++) {
        if (roiGray[i] === 255) {  // ROI 的黑色像素
            blackPixelCount++;
            if (candidateGray[i] === 255) {  // 模板對應位置也是黑色
                matchCount++;
            } else {
                mismatchCount++;  // ROI是黑色但模板是白色，懲罰
            }
        } else {  // ROI 的白色像素
            if (candidateGray[i] === 255) {  // 模板是黑色，這是不匹配
                mismatchCount++;  // ROI是白色但模板是黑色，懲罰
            }
        }
    }

    // 避免除以零
    if (blackPixelCount === 0) return 0;

    // 計算分數: 黑色像素匹配率 - 不匹配懲罰
    const matchRate = matchCount / blackPixelCount;
    const penalty = mismatchCount / roiGray.length;
    return Math.max(0, matchRate - penalty * 0.5);  // 懲罰權重0.5
}
function computeSSIM(img1, img2, width, height) {
    if (img1.length !== img2.length) return 0;

    // 穩定性常數，避免除以零
    const C1 = 6.5025;   // (K1 * L)^2, K1=0.01, L=255
    const C2 = 58.5225;  // (K2 * L)^2, K2=0.03, L=255

    // 步驟1：計算兩張圖像的平均亮度
    let mean1 = 0, mean2 = 0;
    for (let i = 0; i < img1.length; i++) {
        mean1 += img1[i];
        mean2 += img2[i];
    }
    mean1 /= img1.length;
    mean2 /= img2.length;

    // 步驟2：計算方差（對比度）和協方差（結構）
    let variance1 = 0, variance2 = 0, covariance = 0;
    for (let i = 0; i < img1.length; i++) {
        const diff1 = img1[i] - mean1;
        const diff2 = img2[i] - mean2;
        variance1 += diff1 * diff1;   // σ1^2
        variance2 += diff2 * diff2;   // σ2^2
        covariance += diff1 * diff2;  // σ12
    }
    variance1 /= img1.length;
    variance2 /= img2.length;
    covariance /= img1.length;

    // 步驟3：計算 SSIM 指數
    const numerator = (2 * mean1 * mean2 + C1) * (2 * covariance + C2);
    const denominator = (mean1 * mean1 + mean2 * mean2 + C1) * (variance1 + variance2 + C2);

    return numerator / denominator;
}
// recognizeFromGrayMap, recognizeSupAffixNameFromGrayMap
function recognizeFromGrayMap(roiGray, grayMap, threshold = CONFIG.SIMILARITY_THRESHOLD) {
    let bestMatch = null;
    let bestSimilarity = 0;
    const allScores = {};

    // 遍歷所有候選模板，計算相似度
    for (const [key, candidateGray] of Object.entries(grayMap)) {
        const similarity = computePixelSimilarity(roiGray, candidateGray);
        allScores[key] = similarity;

        if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            bestMatch = key;
        }
    }

    return {
        match: bestSimilarity > threshold ? bestMatch : '',
        similarity: bestSimilarity,
        allScores
    };
}
function recognizeSupAffixNameFromGrayMap(roiGray, grayMap, threshold = CONFIG.SIMILARITY_THRESHOLD) {
    let bestMatch = null;
    let bestSimilarity = 0;
    const allScores = {};

    // 遍歷所有候選模板，使用副詞條專用相似度計算
    for (const [key, candidateGray] of Object.entries(grayMap)) {
        const similarity = computeSupAffixNameSimilarity(roiGray, candidateGray);
        allScores[key] = similarity;

        if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            bestMatch = key;
        }
    }

    return {
        match: bestSimilarity > threshold ? bestMatch : '',
        similarity: bestSimilarity,
        allScores
    };
}

// recognizeROI, recognizeNumberOfStars, recognizeResonator, recognizeDifferentColorAttribute
function recognizeROI(roiGray) {
    const result = recognizeFromGrayMap(roiGray, candidateGrayMap);
    const digit = result.match.replace('.png', '').replace('UID_', '');
    return { digit, similarity: result.similarity, allScores: result.allScores };
}

function recognizeNumberOfStars(imageData) {
    let chainLevel = 0;

    // 由低到高逐一檢查 1鏈→6鏈
    for (let i = 0; i < NumberOfStarsCoords.length; i++) {
        const [x, y, w, h] = NumberOfStarsCoords[i];
        const roi = ctx.getImageData(x, y, w, h);
        const roiGray = getGrayROINormal(roi);

        // 與對應模板比對 (NumberOfStars1~6)
        const templateName = `NumberOfStars${i + 1}`;
        const templateGray = NumberOfStarsGrayMap[templateName];

        if (!templateGray) {
            console.warn(`缺少鏈數模板: ${templateName}`);
            break;
        }

        // 使用 SSIM 計算相似度並反轉
        // SSIM 原始值範圍 [-1, 1],值越大越相似
        // 反轉後:相似度高(接近1)變成差異度高(接近-1),用於檢測空白區域
        const rawSSIM = computeSSIM(roiGray, templateGray, w, h);
        const invertedSimilarity = rawSSIM * -1;

        // 反轉後的相似度≥CONFIG.CHAIN_THRESHOLD表示該位置為空白(未激活),立即停止
        if (invertedSimilarity >= CONFIG.CHAIN_THRESHOLD) {
            break;
        }

        // 反轉後的相似度<CONFIG.CHAIN_THRESHOLD表示該鏈已激活,鏈數+1
        chainLevel = i + 1;
    }

    return chainLevel;
}
function recognizeResonator(roiGray) {
    const result = recognizeFromGrayMap(roiGray, resonatorGrayMap);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}

function recognizeDifferentColorAttribute(roiGray) {
    // 使用較低的閾值（0.3）因為屬性圖示辨識相似度較低
    const result = recognizeFromGrayMap(roiGray, differentColorAttributeGrayMap, 0.3);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}

function computeWeightedAttributeSimilarity(roiGray, candidateGray, width, height) {
    if (roiGray.length !== candidateGray.length) return 0;

    // 1. 安全檢查：確保寬高有值，否則權重計算會失效 (導致 isCenter 永遠為 false)
    if (!width || !height) {
        // 嘗試推算 (假設圖片為正方形)
        width = Math.sqrt(roiGray.length);
        height = width;
    }

    let weightedMatchCount = 0;
    let weightedWhitePixelCount = 0;

    // 中心點
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    
    // 2. 動態調整中心區域大小
    // 調整為固定長寬的 1/4 (即中心區域覆蓋長寬的 50%)
    // Math.max(2, ...) 確保至少有 5x5 (半徑2) 的中心區域
    const halfWidth = Math.max(2, Math.floor(width / 4));
    const halfHeight = Math.max(2, Math.floor(height / 4));

    for (let i = 0; i < roiGray.length; i++) {
        // 檢查是否為白色像素 (255)
        if (roiGray[i] === 255) {
            const x = i % width;
            const y = Math.floor(i / width);

            // 檢查是否在中心範圍內
            const isCenter = (x >= centerX - halfWidth && x <= centerX + halfWidth) &&
                             (y >= centerY - halfHeight && y <= centerY + halfHeight);

            // 中心區域權重加倍 (改為 5 倍)
            const weight = isCenter ? 5 : 1;

            weightedWhitePixelCount += weight;

            if (candidateGray[i] === 255) {
                weightedMatchCount += weight;
            }
        }
    }

    if (weightedWhitePixelCount === 0) return 0;
    return weightedMatchCount / weightedWhitePixelCount;
}

function recognizeAttributeFromGrayMap(roiGray, grayMap, width, height, threshold = CONFIG.SIMILARITY_THRESHOLD) {
    let bestMatch = null;
    let bestSimilarity = 0;
    const allScores = {};

    for (const [key, candidateGray] of Object.entries(grayMap)) {
        const similarity = computeWeightedAttributeSimilarity(roiGray, candidateGray, width, height);
        allScores[key] = similarity;

        if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            bestMatch = key;
        }
    }

    return {
        match: bestSimilarity > threshold ? bestMatch : '',
        similarity: bestSimilarity,
        allScores
    };
}

// recognizeAttributes_1~5, recognizeConsumption_1~5, recognizeMainAffix_1~5
function recognizeAttributes_1(roiGray, width, height) {
    const result = recognizeAttributeFromGrayMap(roiGray, AttributesGrayMap1, width, height);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeAttributes_2(roiGray, width, height) {
    const result = recognizeAttributeFromGrayMap(roiGray, AttributesGrayMap2, width, height);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeAttributes_3(roiGray, width, height) {
    const result = recognizeAttributeFromGrayMap(roiGray, AttributesGrayMap3, width, height);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeAttributes_4(roiGray, width, height) {
    const result = recognizeAttributeFromGrayMap(roiGray, AttributesGrayMap4, width, height);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeAttributes_5(roiGray, width, height) {
    const result = recognizeAttributeFromGrayMap(roiGray, AttributesGrayMap5, width, height);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}

// 辨識消耗1-5 ROI
function recognizeConsumption_1(roiGray) {
    const result = recognizeFromGrayMap(roiGray, CostGrayMap1);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeConsumption_2(roiGray) {
    const result = recognizeFromGrayMap(roiGray, CostGrayMap2);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeConsumption_3(roiGray) {
    const result = recognizeFromGrayMap(roiGray, CostGrayMap3);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeConsumption_4(roiGray) {
    const result = recognizeFromGrayMap(roiGray, CostGrayMap4);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeConsumption_5(roiGray) {
    const result = recognizeFromGrayMap(roiGray, CostGrayMap5);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}

// 辨識主詞條1 ROI
function recognizeMainAffix_1(roiGray) {
    let bestMatch = null;
    let bestSimilarity = 0;
    const allScores = {};
    for (const [key, candidateGray] of Object.entries(MainTermGrayMap1)) {
        const similarity = computePixelSimilarity(roiGray, candidateGray);
        allScores[key] = similarity;
        if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            bestMatch = key;
        }
    }
    // 如果相似度 > CONFIG.SIMILARITY_THRESHOLD，返回結果，否則空字串
    return { name: bestSimilarity > CONFIG.SIMILARITY_THRESHOLD ? bestMatch : '', similarity: bestSimilarity, allScores: allScores };
}

// 辨識主詞條2 ROI
function recognizeMainAffix_2(roiGray) {
    const result = recognizeFromGrayMap(roiGray, MainTermGrayMap2);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}

// 辨識主詞條3 ROI
function recognizeMainAffix_3(roiGray) {
    const result = recognizeFromGrayMap(roiGray, MainTermGrayMap3);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}

// 辨識主詞條4 ROI
function recognizeMainAffix_4(roiGray) {
    const result = recognizeFromGrayMap(roiGray, MainTermGrayMap4);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}

// 辨識主詞條5 ROI
function recognizeMainAffix_5(roiGray) {
    const result = recognizeFromGrayMap(roiGray, MainTermGrayMap5);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}


// addMainAffixValue
function addMainAffixValue(position, affixName, costLevel) {
    // 移除詞條名稱前綴（如 "1_衍射傷害加成" -> "衍射傷害加成"）
    const cleanAffixName = affixName.replace(/^\d+_/, '');

    // 檢查是否有對應的消耗等級數據
    if (!mainAffixFixedValues[costLevel]) {
        console.warn(`未找到消耗等級 ${costLevel} 的主詞條數值映射`);
        return affixName;
    }

    // 檢查是否有對應的詞條數值
    const value = mainAffixFixedValues[costLevel][cleanAffixName];
    if (!value) {
        console.warn(`未找到詞條 "${cleanAffixName}" 在消耗等級 ${costLevel} 的數值`);
        return affixName;
    }

    // 返回帶數值的完整詞條（保留原始前綴）
    return `${affixName}+${value}`;
}


// recognizeSupAffix_1_1 ~ 5_5 (所有副詞條辨識函式)
function recognizeSupAffix_1_1(roiGray) {
    const result = recognizeSupAffixNameFromGrayMap(roiGray, SupAffixGrayMap1_1);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeSupAffix_1_2(roiGray) {
    const result = recognizeSupAffixNameFromGrayMap(roiGray, SupAffixGrayMap1_2);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeSupAffix_1_3(roiGray) {
    const result = recognizeSupAffixNameFromGrayMap(roiGray, SupAffixGrayMap1_3);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeSupAffix_1_4(roiGray) {
    const result = recognizeSupAffixNameFromGrayMap(roiGray, SupAffixGrayMap1_4);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeSupAffix_1_5(roiGray) {
    const result = recognizeSupAffixNameFromGrayMap(roiGray, SupAffixGrayMap1_5);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}

function recognizeSupAffix_2_1(roiGray) {
    const result = recognizeSupAffixNameFromGrayMap(roiGray, SupAffixGrayMap2_1);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeSupAffix_2_2(roiGray) {
    const result = recognizeSupAffixNameFromGrayMap(roiGray, SupAffixGrayMap2_2);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeSupAffix_2_3(roiGray) {
    const result = recognizeSupAffixNameFromGrayMap(roiGray, SupAffixGrayMap2_3);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeSupAffix_2_4(roiGray) {
    const result = recognizeSupAffixNameFromGrayMap(roiGray, SupAffixGrayMap2_4);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeSupAffix_2_5(roiGray) {
    const result = recognizeSupAffixNameFromGrayMap(roiGray, SupAffixGrayMap2_5);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}

function recognizeSupAffix_3_1(roiGray) {
    const result = recognizeSupAffixNameFromGrayMap(roiGray, SupAffixGrayMap3_1);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeSupAffix_3_2(roiGray) {
    const result = recognizeSupAffixNameFromGrayMap(roiGray, SupAffixGrayMap3_2);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeSupAffix_3_3(roiGray) {
    const result = recognizeSupAffixNameFromGrayMap(roiGray, SupAffixGrayMap3_3);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeSupAffix_3_4(roiGray) {
    const result = recognizeSupAffixNameFromGrayMap(roiGray, SupAffixGrayMap3_4);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeSupAffix_3_5(roiGray) {
    const result = recognizeSupAffixNameFromGrayMap(roiGray, SupAffixGrayMap3_5);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}

function recognizeSupAffix_4_1(roiGray) {
    const result = recognizeSupAffixNameFromGrayMap(roiGray, SupAffixGrayMap4_1);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeSupAffix_4_2(roiGray) {
    const result = recognizeSupAffixNameFromGrayMap(roiGray, SupAffixGrayMap4_2);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeSupAffix_4_3(roiGray) {
    const result = recognizeSupAffixNameFromGrayMap(roiGray, SupAffixGrayMap4_3);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeSupAffix_4_4(roiGray) {
    const result = recognizeSupAffixNameFromGrayMap(roiGray, SupAffixGrayMap4_4);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeSupAffix_4_5(roiGray) {
    const result = recognizeSupAffixNameFromGrayMap(roiGray, SupAffixGrayMap4_5);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}

function recognizeSupAffix_5_1(roiGray) {
    const result = recognizeSupAffixNameFromGrayMap(roiGray, SupAffixGrayMap5_1);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeSupAffix_5_2(roiGray) {
    const result = recognizeSupAffixNameFromGrayMap(roiGray, SupAffixGrayMap5_2);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeSupAffix_5_3(roiGray) {
    const result = recognizeSupAffixNameFromGrayMap(roiGray, SupAffixGrayMap5_3);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeSupAffix_5_4(roiGray) {
    const result = recognizeSupAffixNameFromGrayMap(roiGray, SupAffixGrayMap5_4);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}
function recognizeSupAffix_5_5(roiGray) {
    const result = recognizeSupAffixNameFromGrayMap(roiGray, SupAffixGrayMap5_5);
    return { name: result.match, similarity: result.similarity, allScores: result.allScores };
}

/**
 * 辨識副詞條數值
 * @param {string} position - 位置標識（例如 '1_1'）
 * @param {string} affixName - 詞條名稱（例如 '攻擊'）
 * @param {number[][]} numberROI - 數值區域的灰階圖
 * @returns {string} 辨識出的數值
 */
function recognizeAffixNumber(position, affixName, numberROI) {
    // 1. 查找該詞條可能的數值範圍
    const possibleValues = affixValueRanges[affixName];

    if (!possibleValues || possibleValues.length === 0) {
        console.warn(`未知的詞條或未定義數值範圍: ${affixName}`);
        return '未定義範圍';
    }

    // 2. 根據位置選擇對應的數值模板庫
    const positionTemplates = allNumberTemplates[position];

    if (!positionTemplates) {
        console.error(`找不到位置 ${position} 的數值模板`);
        return '模板缺失';
    }

    // 3. 只從該位置的模板庫中，篩選出該詞條可能的數值
    const candidateTemplates = {};
    for (const value of possibleValues) {
        if (positionTemplates[value]) {
            candidateTemplates[value] = decodeTemplateImage(positionTemplates[value]);
        } else {
            console.warn(`位置 ${position} 缺少數值 ${value} 的模板`);
        }
    }

    // 4. 檢查是否有可用的候選模板
    if (Object.keys(candidateTemplates).length === 0) {
        console.error(`位置 ${position} 的詞條 ${affixName} 沒有可用的數值模板`);
        return '無候選模板';
    }

    // 5. 在縮小的範圍內進行匹配
    const result = recognizeFromGrayMap(
        numberROI,
        candidateTemplates,
        CONFIG.SIMILARITY_THRESHOLD
    );

    // 6. 返回匹配到的數值（而非整個物件）
    if (result && result.match) {
        return result.match;
    } else {
        return '辨識失敗';
    }
}

// processSupAffixWithNumber
function processSupAffixWithNumber(position, affixResult, imageData) {
    // 1. 從辨識結果物件中取得詞條名稱
    // affixResult 是物件: { name: "攻擊", similarity: 0.95 }
    // 注意：name 已經是純粹的詞條名稱，不包含位置前綴
    let affixName = '';

    if (typeof affixResult === 'string') {
        // 如果是字串格式，直接使用
        affixName = affixResult;
    } else if (affixResult && affixResult.name) {
        // 如果是物件格式，取出 name 屬性
        if (affixResult.name === '') {
            // 空字串表示未辨識（相似度不夠高）
            return {
                position: position,
                affix: '未辨識',
                value: '-'
            };
        }
        affixName = affixResult.name;  // 直接使用，不需要分割
    }

    if (!affixName || affixName === '未辨識') {
        return {
            position: position,
            affix: '未辨識',
            value: '-'
        };
    }

    // 2. 獲取該位置的數值區域座標
    const numberCoord = SupAffixNumberCoords[position];

    if (!numberCoord || numberCoord.every(v => v === 0)) {
        return {
            position: position,
            affix: affixName,
            value: '座標未設定'
        };
    }

    // 3. 從完整圖像中提取數值區域的 ImageData
    const [x, y, w, h] = numberCoord;
    const numberImageData = ctx.getImageData(x, y, w, h);

    // 4. 轉換為灰階資料
    const numberROI = getGrayROI(numberImageData);

    // 5. 使用該位置專屬的模板進行辨識
    const recognizedValue = recognizeAffixNumber(position, affixName, numberROI);

    return {
        position: position,
        affix: affixName,
        value: recognizedValue
    };
}

/**
 * 計算單個詞條的評分
 * @param {string} affixName - 詞條名稱
 * @param {string} affixValue - 詞條數值（字串，可能包含百分號）
 * @param {Object} resonatorWeights - 角色評分權重物件
 * @returns {number} 計算後的評分（保留兩位小數）
 */
function calculateAffixScore(affixName, affixValue, resonatorWeights) {
    if (!affixName || !affixValue || affixValue === '未知' || affixValue === '-' || affixValue === '座標未設定') {
        return 0;
    }

    // 解析數值（移除百分號並轉為數字）
    const isPercentage = affixValue.includes('%');
    const numericValue = parseFloat(affixValue.replace('%', ''));

    if (isNaN(numericValue)) {
        return 0;
    }

    let score = 0;

    // 根據詞條類型進行計算
    switch (affixName) {
        case '暴擊':
            score = numericValue * (resonatorWeights['暴擊'] || 0);
            break;

        case '暴擊傷害':
            score = numericValue * (resonatorWeights['暴擊傷害'] || 0);
            break;

        case '共鳴效率':
            score = numericValue * (resonatorWeights['共鳴效率Min'] || 0);
            break;

        case '衍射傷害加成':
        case '熱熔傷害加成':
        case '湮滅傷害加成':
        case '氣動傷害加成':
        case '導電傷害加成':
        case '冷凝傷害加成':
            score = numericValue * (resonatorWeights['屬傷'] || 0);
            break;

        case '治療效果加成':
            score = numericValue * (resonatorWeights['治療'] || 0);
            break;

        case '普攻傷害加成':
            score = numericValue * (resonatorWeights['專傷'] || 0) * ((resonatorWeights['NormalAttack'] || 0) / 100);
            break;

        case '重擊傷害加成':
            score = numericValue * (resonatorWeights['專傷'] || 0) * ((resonatorWeights['HeavyAttack'] || 0) / 100);
            break;

        case '共鳴技能傷害加成':
            score = numericValue * (resonatorWeights['專傷'] || 0) * ((resonatorWeights['Skills'] || 0) / 100);
            break;

        case '共鳴解放傷害加成':
            score = numericValue * (resonatorWeights['專傷'] || 0) * ((resonatorWeights['SecretWeapon'] || 0) / 100);
            break;

        case '攻擊':
            // 判斷是百分比還是固定值
            if (isPercentage) {
                score = numericValue * (resonatorWeights['攻擊P'] || 0);
            } else {
                score = numericValue * (resonatorWeights['攻擊'] || 0);
            }
            break;

        case '生命':
            if (isPercentage) {
                score = numericValue * (resonatorWeights['生命P'] || 0);
            } else {
                score = numericValue * (resonatorWeights['生命'] || 0);
            }
            break;

        case '防禦':
            if (isPercentage) {
                score = numericValue * (resonatorWeights['防禦P'] || 0);
            } else {
                score = numericValue * (resonatorWeights['防禦'] || 0);
            }
            break;

        default:
            score = 0;
            break;
    }

    // 返回原始評分(不取小數)
    return score;
}

// calculateEchoTotalScore
function calculateEchoTotalScore(allEchoAffix, resonatorWeights, costLevel) {
    let totalScore = 0;
    const maxScore = resonatorWeights['最高分'] || 1; // 避免除以0

    // 計算所有詞條的評分(包含主詞條和副詞條)
    for (let i = 0; i < allEchoAffix.length; i++) {
        const affix = allEchoAffix[i];
        if (affix.Name && affix.Number) {
            const rawScore = calculateAffixScore(affix.Name, affix.Number, resonatorWeights);
            // 標準化評分: (rawScore * 100 / 最高分) 並保留兩位小數
            const normalizedScore = Math.round((rawScore * 100 / maxScore) * 100) / 100;
            affix.Points = normalizedScore;
            totalScore += normalizedScore;
        }
    }

    // 計算固定攻擊加成的評分
    let fixedAttackBonus = 0;
    if (costLevel === '4') {
        fixedAttackBonus = 150;
    } else if (costLevel === '3') {
        fixedAttackBonus = 100;
    }

    // 將固定攻擊轉換為評分並標準化
    if (fixedAttackBonus > 0) {
        const attackWeight = resonatorWeights['攻擊'] || 0;
        const rawAttackScore = fixedAttackBonus * attackWeight;
        const normalizedAttackScore = Math.round((rawAttackScore * 100 / maxScore) * 100) / 100;
        totalScore += normalizedAttackScore;
    }

    return Math.round(totalScore * 100) / 100;
}

// ==================================================================================
// 初始化 (依賴上述資料與函式)
// ==================================================================================

// 預先把候選樣板轉成灰階陣列 (buildGrayMap 呼叫)
const candidateGrayMap = buildGrayMap(templateData.UID, true);

// 預先把鏈數樣板轉成灰階陣列
const NumberOfStarsGrayMap = buildGrayMap(templateData.NumberOfStars);

// 預先把角色樣板轉成灰階陣列
const resonatorGrayMap = buildGrayMap(templateData.Resonator);

// 預先把屬性1-5樣板轉成灰階陣列
const AttributesGrayMap1 = buildGrayMap(templateData.Attributes1);
const AttributesGrayMap2 = buildGrayMap(templateData.Attributes2);
const AttributesGrayMap3 = buildGrayMap(templateData.Attributes3);
const AttributesGrayMap4 = buildGrayMap(templateData.Attributes4);
const AttributesGrayMap5 = buildGrayMap(templateData.Attributes5);

// 預先把消耗1-5樣板轉成灰階陣列
const CostGrayMap1 = buildGrayMap(templateData.Cost1);
const CostGrayMap2 = buildGrayMap(templateData.Cost2);
const CostGrayMap3 = buildGrayMap(templateData.Cost3);
const CostGrayMap4 = buildGrayMap(templateData.Cost4);
const CostGrayMap5 = buildGrayMap(templateData.Cost5);

// 預先把主詞條1-5樣板轉成灰階陣列
const MainTermGrayMap1 = buildGrayMap(templateData.MainAffix1);
const MainTermGrayMap2 = buildGrayMap(templateData.MainAffix2);
const MainTermGrayMap3 = buildGrayMap(templateData.MainAffix3);
const MainTermGrayMap4 = buildGrayMap(templateData.MainAffix4);
const MainTermGrayMap5 = buildGrayMap(templateData.MainAffix5);

// 預先把副詞條1_N樣板轉成灰階陣列
const SupAffixGrayMap1_1 = buildGrayMap(templateData.SupAffix_1_1);
const SupAffixGrayMap1_2 = buildGrayMap(templateData.SupAffix_1_2);
const SupAffixGrayMap1_3 = buildGrayMap(templateData.SupAffix_1_3);
const SupAffixGrayMap1_4 = buildGrayMap(templateData.SupAffix_1_4);
const SupAffixGrayMap1_5 = buildGrayMap(templateData.SupAffix_1_5);

// 預先把副詞條2_N樣板轉成灰階陣列
const SupAffixGrayMap2_1 = buildGrayMap(templateData.SupAffix_2_1);
const SupAffixGrayMap2_2 = buildGrayMap(templateData.SupAffix_2_2);
const SupAffixGrayMap2_3 = buildGrayMap(templateData.SupAffix_2_3);
const SupAffixGrayMap2_4 = buildGrayMap(templateData.SupAffix_2_4);
const SupAffixGrayMap2_5 = buildGrayMap(templateData.SupAffix_2_5);

// 預先把副詞條3_N樣板轉成灰階陣列
const SupAffixGrayMap3_1 = buildGrayMap(templateData.SupAffix_3_1);
const SupAffixGrayMap3_2 = buildGrayMap(templateData.SupAffix_3_2);
const SupAffixGrayMap3_3 = buildGrayMap(templateData.SupAffix_3_3);
const SupAffixGrayMap3_4 = buildGrayMap(templateData.SupAffix_3_4);
const SupAffixGrayMap3_5 = buildGrayMap(templateData.SupAffix_3_5);

// 預先把副詞條4_N樣板轉成灰階陣列
const SupAffixGrayMap4_1 = buildGrayMap(templateData.SupAffix_4_1);
const SupAffixGrayMap4_2 = buildGrayMap(templateData.SupAffix_4_2);
const SupAffixGrayMap4_3 = buildGrayMap(templateData.SupAffix_4_3);
const SupAffixGrayMap4_4 = buildGrayMap(templateData.SupAffix_4_4);
const SupAffixGrayMap4_5 = buildGrayMap(templateData.SupAffix_4_5);

// 預先把副詞條5_N樣板轉成灰階陣列
const SupAffixGrayMap5_1 = buildGrayMap(templateData.SupAffix_5_1);
const SupAffixGrayMap5_2 = buildGrayMap(templateData.SupAffix_5_2);
const SupAffixGrayMap5_3 = buildGrayMap(templateData.SupAffix_5_3);
const SupAffixGrayMap5_4 = buildGrayMap(templateData.SupAffix_5_4);
const SupAffixGrayMap5_5 = buildGrayMap(templateData.SupAffix_5_5);

// 預先把漂泊者屬性樣板轉成灰階陣列
const differentColorAttributeGrayMap = buildGrayMap(differentColorAttributeData);

const charRect = [240, 110, 300, 380];
let currentLayout = 'landscape';
const AUTO_LOAD_FROM_LOCAL = false;

// DOM 元素
const imageInput = document.getElementById('imageInput');
const jsonOutput = document.getElementById('jsonOutput');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const copyBtn = document.getElementById('copyBtn');

// 全域變數
let targetData = null;
let targetFileName = '';
let allEchoList = [];

// DOM 元素
const quickJson = document.getElementById('quickJson');
const mainContent = document.getElementById('mainContent');
const noDataMessage = document.getElementById('noDataMessage');

function recalculateScore(jsonResult) {
    // 取得角色名稱和鏈度
    const resonatorName = jsonResult.Name;
    const resonatorChainLevel = jsonResult.NumberOfStars;

    // 檢查角色是否存在於 resonatorData 中
    if (resonatorData[resonatorName] && resonatorData[resonatorName][resonatorChainLevel]) {
        const resonatorWeights = resonatorData[resonatorName][resonatorChainLevel];

        // 計算每個聲骸的評分
        for (const echo of jsonResult.list) {
            // 計算該聲骸所有詞條的評分(傳入消耗等級)
            echo.Points = calculateEchoTotalScore(echo.AllEchoAffix, resonatorWeights, echo.Cost);
        }

        // 計算總分和有效詞條數
        let totalScore = 0;
        let validAffixCount = 0;
        let totalResonanceEfficiency = 0;

        for (const echo of jsonResult.list) {
            totalScore += echo.Points;

            // 計算有效詞條數(包含主詞條和副詞條)
            for (let i = 0; i < echo.AllEchoAffix.length; i++) {
                const affix = echo.AllEchoAffix[i];
                if (affix.Name && affix.Name !== '未辨識' && affix.Name !== '' &&
                    affix.Number && affix.Number !== '未知' && affix.Number !== '-' && affix.Number !== '座標未設定') {
                    validAffixCount++;

                    // 統計共鳴效率
                    if (affix.Name === '共鳴效率' && affix.Number) {
                        const numericValue = parseFloat(affix.Number.replace('%', ''));
                        if (!isNaN(numericValue)) {
                            totalResonanceEfficiency += numericValue;
                        }
                    }
                }
            }
        }

        // 計算共鳴效率溢出懲罰
        const resonanceThreshold = resonatorWeights['共鳴效率閥值'] || 0;
        const resonanceMin = resonatorWeights['共鳴效率Min'] || 0;
        const resonanceMax = resonatorWeights['共鳴效率Max'] || 0;
        const maxScoreBase = resonatorWeights['最高分'] || 1;

        let finalScore = totalScore;

        if (totalResonanceEfficiency > resonanceThreshold) {
            // 計算溢出部分
            const overflow = totalResonanceEfficiency - resonanceThreshold;
            // 計算懲罰: 溢出值 × (共鳴效率Min - 共鳴效率Max) × 100 ÷ 最高分基準
            const penalty = (overflow * (resonanceMin - resonanceMax) * 100) / maxScoreBase;
            finalScore = totalScore - penalty;
        }
        // 更新總分和有效詞條數（保留兩位小數）
        jsonResult.Total總分 = Math.round(finalScore * 100) / 100;
        jsonResult.ValidAffix = validAffixCount;
        jsonResult.Total共鳴效率 = Math.round(totalResonanceEfficiency * 100) / 100;
    } else {
        // 如果找不到角色數據,設置為 0
        jsonResult.Total總分 = 0;
        jsonResult.ValidAffix = 0;
        jsonResult.Total共鳴效率 = 0;
    }
    return jsonResult;
}

function processImage() {
    const file = imageInput.files[0];
    if (!file) {
        jsonOutput.value = '請選擇圖片';
        return;
    }

    jsonOutput.value = '處理中...';

    const img = new Image();
    img.onload = () => {
        if (img.width !== 1920 || img.height !== 1080) {
            jsonOutput.value = `圖片解析度錯誤: ${img.width}x${img.height} (需要 1920x1080)`;
            return;
        }

        canvas.width = 1920;
        canvas.height = 1080;
        ctx.drawImage(img, 0, 0);

        // 辨識每個 UID 字元
        const results = [];
        for (let i = 0; i < uidCoords.length; i++) {
            const [x, y, w, h] = uidCoords[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const result = recognizeROI(roiGray);
            results.push(result);
        }

        // 辨識鏈數
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const chainLevel = recognizeNumberOfStars(imageData);

        // 辨識每個角色
        const resonatorResults = [];
        for (let i = 0; i < resonatorCoords.length; i++) {
            const [x, y, w, h] = resonatorCoords[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROINormal(imageData);  // 使用正常二值化
            const result = recognizeResonator(roiGray);
            resonatorResults.push(result);
        }

        // 辨識漂泊者屬性（僅當辨識出「漂泊者女」或「漂泊者」時）
        const differentColorAttributeResults = [];
        const recognizedResonator = resonatorResults[0]?.name || '';
        if (recognizedResonator === '漂泊者女' || recognizedResonator === '漂泊者') {
            for (let i = 0; i < DifferentColorAttributeCoords.length; i++) {
                const [x, y, w, h] = DifferentColorAttributeCoords[i];
                const imageData = ctx.getImageData(x, y, w, h);
                const roiGray = getGrayROINormal(imageData);  // 使用二值化
                const result = recognizeDifferentColorAttribute(roiGray);
                differentColorAttributeResults.push(result);
            }
        }

        // 辨識每個屬性1
        const attributes1Results = [];
        for (let i = 0; i < AttributesCoords1.length; i++) {
            const [x, y, w, h] = AttributesCoords1[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROINormal(imageData);  // 使用正常二值化
            const result = recognizeAttributes_1(roiGray, w, h);
            attributes1Results.push(result);
        }

        // 辨識每個屬性2
        const attributes2Results = [];
        for (let i = 0; i < AttributesCoords2.length; i++) {
            const [x, y, w, h] = AttributesCoords2[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROINormal(imageData);  // 使用正常二值化
            const result = recognizeAttributes_2(roiGray, w, h);
            attributes2Results.push(result);
        }

        // 辨識每個屬性3
        const attributes3Results = [];
        for (let i = 0; i < AttributesCoords3.length; i++) {
            const [x, y, w, h] = AttributesCoords3[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROINormal(imageData);  // 使用正常二值化
            const result = recognizeAttributes_3(roiGray, w, h);
            attributes3Results.push(result);
        }

        // 辨識每個屬性4
        const attributes4Results = [];
        for (let i = 0; i < AttributesCoords4.length; i++) {
            const [x, y, w, h] = AttributesCoords4[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROINormal(imageData);  // 使用正常二值化
            const result = recognizeAttributes_4(roiGray, w, h);
            attributes4Results.push(result);
        }

        // 辨識每個屬性5
        const attributes5Results = [];
        for (let i = 0; i < AttributesCoords5.length; i++) {
            const [x, y, w, h] = AttributesCoords5[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROINormal(imageData);  // 使用正常二值化
            const result = recognizeAttributes_5(roiGray, w, h);
            attributes5Results.push(result);
        }

        // 辨識每個消耗1
        const cost1Results = [];
        for (let i = 0; i < CostCoords1.length; i++) {
            const [x, y, w, h] = CostCoords1[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);  // 使用正常二值化
            const result = recognizeConsumption_1(roiGray);
            cost1Results.push(result);
        }
        // 辨識每個消耗2
        const cost2Results = [];
        for (let i = 0; i < CostCoords2.length; i++) {
            const [x, y, w, h] = CostCoords2[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);  // 使用正常二值化
            const result = recognizeConsumption_2(roiGray);
            cost2Results.push(result);
        }
        // 辨識每個消耗3
        const cost3Results = [];
        for (let i = 0; i < CostCoords3.length; i++) {
            const [x, y, w, h] = CostCoords3[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);  // 使用正常二值化
            const result = recognizeConsumption_3(roiGray);
            cost3Results.push(result);
        }
        // 辨識每個消耗4
        const cost4Results = [];
        for (let i = 0; i < CostCoords4.length; i++) {
            const [x, y, w, h] = CostCoords4[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);  // 使用正常二值化
            const result = recognizeConsumption_4(roiGray);
            cost4Results.push(result);
        }
        // 辨識每個消耗5
        const cost5Results = [];
        for (let i = 0; i < CostCoords5.length; i++) {
            const [x, y, w, h] = CostCoords5[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);  // 使用正常二值化
            const result = recognizeConsumption_5(roiGray);
            cost5Results.push(result);
        }

        // 辨識每個主詞條1
        const mainAffix1Results = [];
        for (let i = 0; i < MainTermCoords1.length; i++) {
            const [x, y, w, h] = MainTermCoords1[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);  // 使用正常二值化
            const result = recognizeMainAffix_1(roiGray);
            // 根據消耗等級添加固定數值
            const costLevel = cost1Results[0]?.name?.replace(/^\d+_/, '') || '';
            const affixWithValue = addMainAffixValue(1, result.name, costLevel);
            mainAffix1Results.push({ ...result, nameWithValue: affixWithValue });
        }
        // 辨識每個主詞條2
        const mainAffix2Results = [];
        for (let i = 0; i < MainTermCoords2.length; i++) {
            const [x, y, w, h] = MainTermCoords2[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);  // 使用正常二值化
            const result = recognizeMainAffix_2(roiGray);
            // 根據消耗等級添加固定數值
            const costLevel = cost2Results[0]?.name?.replace(/^\d+_/, '') || '';
            const affixWithValue = addMainAffixValue(2, result.name, costLevel);
            mainAffix2Results.push({ ...result, nameWithValue: affixWithValue });
        }
        // 辨識每個主詞條3
        const mainAffix3Results = [];
        for (let i = 0; i < MainTermCoords3.length; i++) {
            const [x, y, w, h] = MainTermCoords3[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);  // 使用正常二值化
            const result = recognizeMainAffix_3(roiGray);
            // 根據消耗等級添加固定數值
            const costLevel = cost3Results[0]?.name?.replace(/^\d+_/, '') || '';
            const affixWithValue = addMainAffixValue(3, result.name, costLevel);
            mainAffix3Results.push({ ...result, nameWithValue: affixWithValue });
        }
        // 辨識每個主詞條4
        const mainAffix4Results = [];
        for (let i = 0; i < MainTermCoords4.length; i++) {
            const [x, y, w, h] = MainTermCoords4[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);  // 使用正常二值化
            const result = recognizeMainAffix_4(roiGray);
            // 根據消耗等級添加固定數值
            const costLevel = cost4Results[0]?.name?.replace(/^\d+_/, '') || '';
            const affixWithValue = addMainAffixValue(4, result.name, costLevel);
            mainAffix4Results.push({ ...result, nameWithValue: affixWithValue });
        }

        // 辨識每個主詞條5
        const mainAffix5Results = [];
        for (let i = 0; i < MainTermCoords5.length; i++) {
            const [x, y, w, h] = MainTermCoords5[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);  // 使用正常二值化
            const result = recognizeMainAffix_5(roiGray);
            // 根據消耗等級添加固定數值
            const costLevel = cost5Results[0]?.name?.replace(/^\d+_/, '') || '';
            const affixWithValue = addMainAffixValue(5, result.name, costLevel);
            mainAffix5Results.push({ ...result, nameWithValue: affixWithValue });
        }

        // 辨識每個副詞條_1_N（包含詞條名稱和數值）
        const supAffix1_1Results = [];
        for (let i = 0; i < SupAffixCoords1_1.length; i++) {
            const [x, y, w, h] = SupAffixCoords1_1[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const affixResult = recognizeSupAffix_1_1(roiGray);
            // 辨識數值並組合結果
            const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const detailedResult = processSupAffixWithNumber('1_1', affixResult, fullImageData);
            supAffix1_1Results.push(detailedResult);
        }
        const supAffix1_2Results = [];
        for (let i = 0; i < SupAffixCoords1_2.length; i++) {
            const [x, y, w, h] = SupAffixCoords1_2[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const affixResult = recognizeSupAffix_1_2(roiGray);
            const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const detailedResult = processSupAffixWithNumber('1_2', affixResult, fullImageData);
            supAffix1_2Results.push(detailedResult);
        }
        const supAffix1_3Results = [];
        for (let i = 0; i < SupAffixCoords1_3.length; i++) {
            const [x, y, w, h] = SupAffixCoords1_3[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const affixResult = recognizeSupAffix_1_3(roiGray);
            const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const detailedResult = processSupAffixWithNumber('1_3', affixResult, fullImageData);
            supAffix1_3Results.push(detailedResult);
        }
        const supAffix1_4Results = [];
        for (let i = 0; i < SupAffixCoords1_4.length; i++) {
            const [x, y, w, h] = SupAffixCoords1_4[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const affixResult = recognizeSupAffix_1_4(roiGray);
            const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const detailedResult = processSupAffixWithNumber('1_4', affixResult, fullImageData);
            supAffix1_4Results.push(detailedResult);
        }
        const supAffix1_5Results = [];
        for (let i = 0; i < SupAffixCoords1_5.length; i++) {
            const [x, y, w, h] = SupAffixCoords1_5[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const affixResult = recognizeSupAffix_1_5(roiGray);
            const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const detailedResult = processSupAffixWithNumber('1_5', affixResult, fullImageData);
            supAffix1_5Results.push(detailedResult);
        }

        // 辨識每個副詞條_2_N（包含詞條名稱和數值）
        const supAffix2_1Results = [];
        for (let i = 0; i < SupAffixCoords2_1.length; i++) {
            const [x, y, w, h] = SupAffixCoords2_1[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const affixResult = recognizeSupAffix_2_1(roiGray);
            const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const detailedResult = processSupAffixWithNumber('2_1', affixResult, fullImageData);
            supAffix2_1Results.push(detailedResult);
        }
        const supAffix2_2Results = [];
        for (let i = 0; i < SupAffixCoords2_2.length; i++) {
            const [x, y, w, h] = SupAffixCoords2_2[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const affixResult = recognizeSupAffix_2_2(roiGray);
            const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const detailedResult = processSupAffixWithNumber('2_2', affixResult, fullImageData);
            supAffix2_2Results.push(detailedResult);
        }
        const supAffix2_3Results = [];
        for (let i = 0; i < SupAffixCoords2_3.length; i++) {
            const [x, y, w, h] = SupAffixCoords2_3[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const affixResult = recognizeSupAffix_2_3(roiGray);
            const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const detailedResult = processSupAffixWithNumber('2_3', affixResult, fullImageData);
            supAffix2_3Results.push(detailedResult);
        }
        const supAffix2_4Results = [];
        for (let i = 0; i < SupAffixCoords2_4.length; i++) {
            const [x, y, w, h] = SupAffixCoords2_4[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const affixResult = recognizeSupAffix_2_4(roiGray);
            const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const detailedResult = processSupAffixWithNumber('2_4', affixResult, fullImageData);
            supAffix2_4Results.push(detailedResult);
        }
        const supAffix2_5Results = [];
        for (let i = 0; i < SupAffixCoords2_5.length; i++) {
            const [x, y, w, h] = SupAffixCoords2_5[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const affixResult = recognizeSupAffix_2_5(roiGray);
            const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const detailedResult = processSupAffixWithNumber('2_5', affixResult, fullImageData);
            supAffix2_5Results.push(detailedResult);
        }


        // 辨識每個副詞條_3_N（包含詞條名稱和數值）
        const supAffix3_1Results = [];
        for (let i = 0; i < SupAffixCoords3_1.length; i++) {
            const [x, y, w, h] = SupAffixCoords3_1[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const affixResult = recognizeSupAffix_3_1(roiGray);
            const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const detailedResult = processSupAffixWithNumber('3_1', affixResult, fullImageData);
            supAffix3_1Results.push(detailedResult);
        }
        const supAffix3_2Results = [];
        for (let i = 0; i < SupAffixCoords3_2.length; i++) {
            const [x, y, w, h] = SupAffixCoords3_2[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const affixResult = recognizeSupAffix_3_2(roiGray);
            const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const detailedResult = processSupAffixWithNumber('3_2', affixResult, fullImageData);
            supAffix3_2Results.push(detailedResult);
        }
        const supAffix3_3Results = [];
        for (let i = 0; i < SupAffixCoords3_3.length; i++) {
            const [x, y, w, h] = SupAffixCoords3_3[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const affixResult = recognizeSupAffix_3_3(roiGray);
            const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const detailedResult = processSupAffixWithNumber('3_3', affixResult, fullImageData);
            supAffix3_3Results.push(detailedResult);
        }
        const supAffix3_4Results = [];
        for (let i = 0; i < SupAffixCoords3_4.length; i++) {
            const [x, y, w, h] = SupAffixCoords3_4[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const affixResult = recognizeSupAffix_3_4(roiGray);
            const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const detailedResult = processSupAffixWithNumber('3_4', affixResult, fullImageData);
            supAffix3_4Results.push(detailedResult);
        }
        const supAffix3_5Results = [];
        for (let i = 0; i < SupAffixCoords3_5.length; i++) {
            const [x, y, w, h] = SupAffixCoords3_5[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const affixResult = recognizeSupAffix_3_5(roiGray);
            const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const detailedResult = processSupAffixWithNumber('3_5', affixResult, fullImageData);
            supAffix3_5Results.push(detailedResult);
        }

        // 辨識每個副詞條_4_N（包含詞條名稱和數值）
        const supAffix4_1Results = [];
        for (let i = 0; i < SupAffixCoords4_1.length; i++) {
            const [x, y, w, h] = SupAffixCoords4_1[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const affixResult = recognizeSupAffix_4_1(roiGray);
            const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const detailedResult = processSupAffixWithNumber('4_1', affixResult, fullImageData);
            supAffix4_1Results.push(detailedResult);
        }
        const supAffix4_2Results = [];
        for (let i = 0; i < SupAffixCoords4_2.length; i++) {
            const [x, y, w, h] = SupAffixCoords4_2[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const affixResult = recognizeSupAffix_4_2(roiGray);
            const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const detailedResult = processSupAffixWithNumber('4_2', affixResult, fullImageData);
            supAffix4_2Results.push(detailedResult);
        }
        const supAffix4_3Results = [];
        for (let i = 0; i < SupAffixCoords4_3.length; i++) {
            const [x, y, w, h] = SupAffixCoords4_3[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const affixResult = recognizeSupAffix_4_3(roiGray);
            const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const detailedResult = processSupAffixWithNumber('4_3', affixResult, fullImageData);
            supAffix4_3Results.push(detailedResult);
        }
        const supAffix4_4Results = [];
        for (let i = 0; i < SupAffixCoords4_4.length; i++) {
            const [x, y, w, h] = SupAffixCoords4_4[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const affixResult = recognizeSupAffix_4_4(roiGray);
            const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const detailedResult = processSupAffixWithNumber('4_4', affixResult, fullImageData);
            supAffix4_4Results.push(detailedResult);
        }
        const supAffix4_5Results = [];
        for (let i = 0; i < SupAffixCoords4_5.length; i++) {
            const [x, y, w, h] = SupAffixCoords4_5[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const affixResult = recognizeSupAffix_4_5(roiGray);
            const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const detailedResult = processSupAffixWithNumber('4_5', affixResult, fullImageData);
            supAffix4_5Results.push(detailedResult);
        }


        // 辨識每個副詞條_5_N（包含詞條名稱和數值）
        const supAffix5_1Results = [];
        for (let i = 0; i < SupAffixCoords5_1.length; i++) {
            const [x, y, w, h] = SupAffixCoords5_1[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const affixResult = recognizeSupAffix_5_1(roiGray);
            const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const detailedResult = processSupAffixWithNumber('5_1', affixResult, fullImageData);
            supAffix5_1Results.push(detailedResult);
        }
        const supAffix5_2Results = [];
        for (let i = 0; i < SupAffixCoords5_2.length; i++) {
            const [x, y, w, h] = SupAffixCoords5_2[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const affixResult = recognizeSupAffix_5_2(roiGray);
            const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const detailedResult = processSupAffixWithNumber('5_2', affixResult, fullImageData);
            supAffix5_2Results.push(detailedResult);
        }
        const supAffix5_3Results = [];
        for (let i = 0; i < SupAffixCoords5_3.length; i++) {
            const [x, y, w, h] = SupAffixCoords5_3[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const affixResult = recognizeSupAffix_5_3(roiGray);
            const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const detailedResult = processSupAffixWithNumber('5_3', affixResult, fullImageData);
            supAffix5_3Results.push(detailedResult);
        }
        const supAffix5_4Results = [];
        for (let i = 0; i < SupAffixCoords5_4.length; i++) {
            const [x, y, w, h] = SupAffixCoords5_4[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const affixResult = recognizeSupAffix_5_4(roiGray);
            const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const detailedResult = processSupAffixWithNumber('5_4', affixResult, fullImageData);
            supAffix5_4Results.push(detailedResult);
        }
        const supAffix5_5Results = [];
        for (let i = 0; i < SupAffixCoords5_5.length; i++) {
            const [x, y, w, h] = SupAffixCoords5_5[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const affixResult = recognizeSupAffix_5_5(roiGray);
            const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const detailedResult = processSupAffixWithNumber('5_5', affixResult, fullImageData);
            supAffix5_5Results.push(detailedResult);
        }

        // 顯示文字結果（顯示 UID 和角色辨識結果）
        const digits = results.map(r => r.digit).join('');
        const resonators = resonatorResults.map(r => r.name || '未知').join(', ');
        const attributes1 = attributes1Results.map(r => r.name || '未知').join(', ');
        const attributes2 = attributes2Results.map(r => r.name || '未知').join(', ');
        const attributes3 = attributes3Results.map(r => r.name || '未知').join(', ');
        const attributes4 = attributes4Results.map(r => r.name || '未知').join(', ');
        const attributes5 = attributes5Results.map(r => r.name || '未知').join(', ');
        const cost1 = cost1Results.map(r => r.name || '未知').join(', ');
        const cost2 = cost2Results.map(r => r.name || '未知').join(', ');
        const cost3 = cost3Results.map(r => r.name || '未知').join(', ');
        const cost4 = cost4Results.map(r => r.name || '未知').join(', ');
        const cost5 = cost5Results.map(r => r.name || '未知').join(', ');
        const mainAffix1 = mainAffix1Results.map(r => r.name || '未知').join(', ');
        const mainAffix2 = mainAffix2Results.map(r => r.name || '未知').join(', ');
        const mainAffix3 = mainAffix3Results.map(r => r.name || '未知').join(', ');
        const mainAffix4 = mainAffix4Results.map(r => r.name || '未知').join(', ');
        const mainAffix5 = mainAffix5Results.map(r => r.name || '未知').join(', ');

        // 副詞條結果格式化（包含詞條名稱和數值）
        const formatSupAffix = (result) => {
            if (!result.affix || result.affix === '未辨識') return '未辨識';
            return `${result.affix}: ${result.value || '未知'}`;
        };

        const supAffix1_1 = supAffix1_1Results.map(formatSupAffix).join(', ');
        const supAffix1_2 = supAffix1_2Results.map(formatSupAffix).join(', ');
        const supAffix1_3 = supAffix1_3Results.map(formatSupAffix).join(', ');
        const supAffix1_4 = supAffix1_4Results.map(formatSupAffix).join(', ');
        const supAffix1_5 = supAffix1_5Results.map(formatSupAffix).join(', ');
        const supAffix2_1 = supAffix2_1Results.map(formatSupAffix).join(', ');
        const supAffix2_2 = supAffix2_2Results.map(formatSupAffix).join(', ');
        const supAffix2_3 = supAffix2_3Results.map(formatSupAffix).join(', ');
        const supAffix2_4 = supAffix2_4Results.map(formatSupAffix).join(', ');
        const supAffix2_5 = supAffix2_5Results.map(formatSupAffix).join(', ');
        const supAffix3_1 = supAffix3_1Results.map(formatSupAffix).join(', ');
        const supAffix3_2 = supAffix3_2Results.map(formatSupAffix).join(', ');
        const supAffix3_3 = supAffix3_3Results.map(formatSupAffix).join(', ');
        const supAffix3_4 = supAffix3_4Results.map(formatSupAffix).join(', ');
        const supAffix3_5 = supAffix3_5Results.map(formatSupAffix).join(', ');
        const supAffix4_1 = supAffix4_1Results.map(formatSupAffix).join(', ');
        const supAffix4_2 = supAffix4_2Results.map(formatSupAffix).join(', ');
        const supAffix4_3 = supAffix4_3Results.map(formatSupAffix).join(', ');
        const supAffix4_4 = supAffix4_4Results.map(formatSupAffix).join(', ');
        const supAffix4_5 = supAffix4_5Results.map(formatSupAffix).join(', ');
        const supAffix5_1 = supAffix5_1Results.map(formatSupAffix).join(', ');
        const supAffix5_2 = supAffix5_2Results.map(formatSupAffix).join(', ');
        const supAffix5_3 = supAffix5_3Results.map(formatSupAffix).join(', ');
        const supAffix5_4 = supAffix5_4Results.map(formatSupAffix).join(', ');
        const supAffix5_5 = supAffix5_5Results.map(formatSupAffix).join(', ');

        // 輔助函數：移除字串開頭的 "N_" 前綴（N為數字）
        const removePrefix = (str) => {
            if (!str) return str;
            return str.replace(/^\d+_/, '');
        };

        // 輔助函數：從帶數值的主詞條字串中提取名稱和數值
        // 格式: "詞條名稱+數值" -> { name: "詞條名稱", value: "數值" }
        const parseMainAffix = (affixWithValue) => {
            if (!affixWithValue) return { name: '', value: '' };
            const parts = affixWithValue.split('+');
            if (parts.length === 2) {
                return { name: parts[0], value: parts[1] };
            }
            return { name: affixWithValue, value: '' };
        };

        // 處理漂泊者屬性辨識結果
        let finalResonatorName = resonators;
        if (resonators === '漂泊者女' || resonators === '漂泊者') {
            // 如果辨識出漂泊者，根據屬性辨識結果修正Name
            const attributeResult = differentColorAttributeResults[0];
            if (attributeResult && attributeResult.name) {
                switch (attributeResult.name) {
                    case '衍射':
                        finalResonatorName = '漂泊者';
                        break;
                    case '湮滅':
                        finalResonatorName = '漂泊者-湮滅';
                        break;
                    case '氣動':
                        finalResonatorName = '漂泊者-氣動';
                        break;
                    default:
                        // 如果無法辨識屬性，保持原名稱
                        break;
                }
            }
        }

        // Capture Debug Images
        const captureEchoDebugImages = (echoIdx) => {
            const idx1 = echoIdx + 1;
            const debugData = { Attribute: '', Cost: '', MainAffix: '', SubAffixes: [] };

            const getCoords = (name) => { try { return eval(name); } catch (e) { return null; } };

            // Attribute
            const attrCoords = getCoords(`AttributesCoords${idx1}`);
            if (attrCoords && attrCoords.length > 0) {
                const [x, y, w, h] = attrCoords[0];
                debugData.Attribute = cropImageAsBase64(x, y, w, h);
            }

            // Cost
            const costCoords = getCoords(`CostCoords${idx1}`);
            if (costCoords && costCoords.length > 0) {
                const [x, y, w, h] = costCoords[0];
                debugData.Cost = cropImageAsBase64(x, y, w, h);
            }

            // Main Affix
            const mainCoords = getCoords(`MainTermCoords${idx1}`);
            if (mainCoords && mainCoords.length > 0) {
                const [x, y, w, h] = mainCoords[0];
                debugData.MainAffix = cropImageAsBase64(x, y, w, h);
            }

            // Sub Affixes
            for (let subIdx = 1; subIdx <= 5; subIdx++) {
                const subData = { Name: '', Value: '' };
                const nameCoords = getCoords(`SupAffixCoords${idx1}_${subIdx}`);
                if (nameCoords && nameCoords.length > 0) {
                    const [x, y, w, h] = nameCoords[0];
                    subData.Name = cropImageAsBase64(x, y, w, h);
                }
                const valCoord = SupAffixNumberCoords[`${idx1}_${subIdx}`];
                if (valCoord) {
                    const [x, y, w, h] = valCoord;
                    subData.Value = cropImageAsBase64(x, y, w, h);
                }
                debugData.SubAffixes.push(subData);
            }
            return debugData;
        };

        // 建立 JSON 結果物件
        const jsonResult = {
            Name: finalResonatorName,
            NameImage: resonators,
            UID: digits,
            ValidAffix: '',
            Total共鳴效率: '',
            Total總分: '',
            NumberOfStars: chainLevel,
            list: [
                {
                    Id: 0,
                    DebugImages: captureEchoDebugImages(0),
                    Cost: removePrefix(cost1),
                    Attributes: removePrefix(attributes1),
                    AllEchoAffix: [
                        {
                            Name: (() => {
                                const parsed = parseMainAffix(mainAffix1Results[0]?.nameWithValue || '');
                                return removePrefix(parsed.name);
                            })(),
                            Number: (() => {
                                const parsed = parseMainAffix(mainAffix1Results[0]?.nameWithValue || '');
                                return parsed.value;
                            })(),
                            Points: 0
                        },
                        { Name: removePrefix(supAffix1_1Results[0]?.affix || ''), Number: supAffix1_1Results[0]?.value || '', Points: 0 },
                        { Name: removePrefix(supAffix1_2Results[0]?.affix || ''), Number: supAffix1_2Results[0]?.value || '', Points: 0 },
                        { Name: removePrefix(supAffix1_3Results[0]?.affix || ''), Number: supAffix1_3Results[0]?.value || '', Points: 0 },
                        { Name: removePrefix(supAffix1_4Results[0]?.affix || ''), Number: supAffix1_4Results[0]?.value || '', Points: 0 },
                        { Name: removePrefix(supAffix1_5Results[0]?.affix || ''), Number: supAffix1_5Results[0]?.value || '', Points: 0 }
                    ],
                    Points: 0
                },
                {
                    Id: 0,
                    DebugImages: captureEchoDebugImages(1),
                    Cost: removePrefix(cost2),
                    Attributes: removePrefix(attributes2),
                    AllEchoAffix: [
                        {
                            Name: (() => {
                                const parsed = parseMainAffix(mainAffix2Results[0]?.nameWithValue || '');
                                return removePrefix(parsed.name);
                            })(),
                            Number: (() => {
                                const parsed = parseMainAffix(mainAffix2Results[0]?.nameWithValue || '');
                                return parsed.value;
                            })(),
                            Points: 0
                        },
                        { Name: removePrefix(supAffix2_1Results[0]?.affix || ''), Number: supAffix2_1Results[0]?.value || '', Points: 0 },
                        { Name: removePrefix(supAffix2_2Results[0]?.affix || ''), Number: supAffix2_2Results[0]?.value || '', Points: 0 },
                        { Name: removePrefix(supAffix2_3Results[0]?.affix || ''), Number: supAffix2_3Results[0]?.value || '', Points: 0 },
                        { Name: removePrefix(supAffix2_4Results[0]?.affix || ''), Number: supAffix2_4Results[0]?.value || '', Points: 0 },
                        { Name: removePrefix(supAffix2_5Results[0]?.affix || ''), Number: supAffix2_5Results[0]?.value || '', Points: 0 }
                    ],
                    Points: 0
                },
                {
                    Id: 0,
                    DebugImages: captureEchoDebugImages(2),
                    Cost: removePrefix(cost3),
                    Attributes: removePrefix(attributes3),
                    AllEchoAffix: [
                        {
                            Name: (() => {
                                const parsed = parseMainAffix(mainAffix3Results[0]?.nameWithValue || '');
                                return removePrefix(parsed.name);
                            })(),
                            Number: (() => {
                                const parsed = parseMainAffix(mainAffix3Results[0]?.nameWithValue || '');
                                return parsed.value;
                            })(),
                            Points: 0
                        },
                        { Name: removePrefix(supAffix3_1Results[0]?.affix || ''), Number: supAffix3_1Results[0]?.value || '', Points: 0 },
                        { Name: removePrefix(supAffix3_2Results[0]?.affix || ''), Number: supAffix3_2Results[0]?.value || '', Points: 0 },
                        { Name: removePrefix(supAffix3_3Results[0]?.affix || ''), Number: supAffix3_3Results[0]?.value || '', Points: 0 },
                        { Name: removePrefix(supAffix3_4Results[0]?.affix || ''), Number: supAffix3_4Results[0]?.value || '', Points: 0 },
                        { Name: removePrefix(supAffix3_5Results[0]?.affix || ''), Number: supAffix3_5Results[0]?.value || '', Points: 0 }
                    ],
                    Points: 0
                },
                {
                    Id: 0,
                    DebugImages: captureEchoDebugImages(3),
                    Cost: removePrefix(cost4),
                    Attributes: removePrefix(attributes4),
                    AllEchoAffix: [
                        {
                            Name: (() => {
                                const parsed = parseMainAffix(mainAffix4Results[0]?.nameWithValue || '');
                                return removePrefix(parsed.name);
                            })(),
                            Number: (() => {
                                const parsed = parseMainAffix(mainAffix4Results[0]?.nameWithValue || '');
                                return parsed.value;
                            })(),
                            Points: 0
                        },
                        { Name: removePrefix(supAffix4_1Results[0]?.affix || ''), Number: supAffix4_1Results[0]?.value || '', Points: 0 },
                        { Name: removePrefix(supAffix4_2Results[0]?.affix || ''), Number: supAffix4_2Results[0]?.value || '', Points: 0 },
                        { Name: removePrefix(supAffix4_3Results[0]?.affix || ''), Number: supAffix4_3Results[0]?.value || '', Points: 0 },
                        { Name: removePrefix(supAffix4_4Results[0]?.affix || ''), Number: supAffix4_4Results[0]?.value || '', Points: 0 },
                        { Name: removePrefix(supAffix4_5Results[0]?.affix || ''), Number: supAffix4_5Results[0]?.value || '', Points: 0 }
                    ],
                    Points: 0
                },
                {
                    Id: 0,
                    DebugImages: captureEchoDebugImages(4),
                    Cost: removePrefix(cost5),
                    Attributes: removePrefix(attributes5),
                    AllEchoAffix: [
                        {
                            Name: (() => {
                                const parsed = parseMainAffix(mainAffix5Results[0]?.nameWithValue || '');
                                return removePrefix(parsed.name);
                            })(),
                            Number: (() => {
                                const parsed = parseMainAffix(mainAffix5Results[0]?.nameWithValue || '');
                                return parsed.value;
                            })(),
                            Points: 0
                        },
                        { Name: removePrefix(supAffix5_1Results[0]?.affix || ''), Number: supAffix5_1Results[0]?.value || '', Points: 0 },
                        { Name: removePrefix(supAffix5_2Results[0]?.affix || ''), Number: supAffix5_2Results[0]?.value || '', Points: 0 },
                        { Name: removePrefix(supAffix5_3Results[0]?.affix || ''), Number: supAffix5_3Results[0]?.value || '', Points: 0 },
                        { Name: removePrefix(supAffix5_4Results[0]?.affix || ''), Number: supAffix5_4Results[0]?.value || '', Points: 0 },
                        { Name: removePrefix(supAffix5_5Results[0]?.affix || ''), Number: supAffix5_5Results[0]?.value || '', Points: 0 }
                    ],
                    Points: 0
                }
            ]
        };

        // ===== 計算評分 =====
        recalculateScore(jsonResult);

        // 顯示 JSON 結果
        jsonOutput.value = JSON.stringify(jsonResult, null, 2);

        // 設定聲骸列表供匯出使用
        allEchoList = jsonResult.list;
        checkCanExport();
    };

    img.onerror = () => {
        jsonOutput.value = '圖片載入失敗';
    };

    img.src = URL.createObjectURL(file);
}

// 綁定事件 (模擬 index copy.html 的行為)
imageInput.addEventListener('change', (e) => {
    // 1. 執行辨識
    processImage();
});

//// URL 按鈕事件處理
const urlBtn = document.getElementById('urlBtn');
const urlInputModal = document.getElementById('urlInputModal');
const closeUrlModalBtn = document.getElementById('closeUrlModalBtn');
const imageUrlInput = document.getElementById('imageUrlInput');
const scoreFromUrlBtn = document.getElementById('scoreFromUrlBtn');
const urlModalMessage = document.getElementById('urlModalMessage');

// 開啟 URL 輸入模態框
if (urlBtn) {
    urlBtn.addEventListener('click', () => {
        if (urlInputModal) {
            urlInputModal.classList.add('show');
            if (imageUrlInput) imageUrlInput.value = '';
            if (scoreFromUrlBtn) scoreFromUrlBtn.disabled = true;
            if (urlModalMessage) {
                urlModalMessage.style.display = 'none';
                urlModalMessage.className = 'message';
            }
        }
    });
}

// 關閉 URL 輸入模態框
if (closeUrlModalBtn) {
    closeUrlModalBtn.addEventListener('click', () => {
        if (urlInputModal) urlInputModal.classList.remove('show');
    });
}

// URL 輸入驗證
if (imageUrlInput) {
    imageUrlInput.addEventListener('input', () => {
        const url = imageUrlInput.value.trim();
        const isValid = url.startsWith('https://wutheringwaves-dc.kurogames-global.com') && url.endsWith('.jpeg');

        if (scoreFromUrlBtn) {
            scoreFromUrlBtn.disabled = !isValid;
        }
    });
}

// 評分按鈕事件處理
if (scoreFromUrlBtn) {
    scoreFromUrlBtn.addEventListener('click', async () => {
        const imageUrl = imageUrlInput.value.trim();

        if (!imageUrl) {
            showUrlMessage('請輸入圖片網址', 'error');
            return;
        }

        if (!imageUrl.startsWith('https://wutheringwaves-dc.kurogames-global.com') || !imageUrl.endsWith('.jpeg')) {
            showUrlMessage('網址格式不正確', 'error');
            return;
        }

        scoreFromUrlBtn.disabled = true;
        showUrlMessage('正在載入圖片...', 'success');

        try {
            // 固定的 GCF URL
            const proxyUrl = `${GCF_URL}?url=${encodeURIComponent(imageUrl)}`;

            // 載入圖片
            const img = new Image();
            img.crossOrigin = 'Anonymous';

            img.onload = () => {
                // 將圖片繪製到 canvas
                const canvas = document.getElementById('canvas');
                const ctx = canvas.getContext('2d');

                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);

                // 將 canvas 轉換為 blob，然後觸發圖片處理流程
                canvas.toBlob((blob) => {
                    if (blob) {
                        // 建立一個 File 對象
                        const file = new File([blob], 'image.jpg', { type: 'image/jpeg' });

                        // 建立一個 FileList-like 對象
                        const dataTransfer = new DataTransfer();
                        dataTransfer.items.add(file);

                        // 設定到 imageInput
                        if (imageInput) {
                            imageInput.files = dataTransfer.files;
                            // 觸發處理
                            processImage();
                        }

                        // 關閉模態框
                        if (urlInputModal) urlInputModal.classList.remove('show');
                        showUrlMessage('圖片載入成功', 'success');
                    } else {
                        showUrlMessage('圖片轉換失敗', 'error');
                        scoreFromUrlBtn.disabled = false;
                    }
                }, 'image/jpeg');
            };

            img.onerror = (e) => {
                console.error('圖片載入失敗', e);
                showUrlMessage('圖片載入失敗，請檢查網址是否正確', 'error');
                scoreFromUrlBtn.disabled = false;
            };

            // 開始載入
            img.src = proxyUrl;

        } catch (error) {
            console.error('錯誤:', error);
            showUrlMessage('發生錯誤: ' + error.message, 'error');
            scoreFromUrlBtn.disabled = false;
        }
    });
}

// 顯示 URL 模態框訊息
function showUrlMessage(msg, type) {
    if (urlModalMessage) {
        urlModalMessage.textContent = msg;
        urlModalMessage.className = `message ${type}`;
        urlModalMessage.style.display = 'block';

        if (type === 'success') {
            setTimeout(() => {
                urlModalMessage.style.display = 'none';
            }, 2000);
        }
    }
}

// 攔截 checkCanExport 以觸發渲染
// 當 processImage 完成時會呼叫 checkCanExport，我們利用這個時機來更新 UI
function checkCanExport() {
    const val = jsonOutput.value;
    if (val && val.startsWith('{')) {
        try {
            const data = JSON.parse(val);

            // 儲存前剔除影像資料以節省空間
            const storageData = JSON.parse(JSON.stringify(data));
            if (storageData.list) {
                storageData.list.forEach(echo => delete echo.DebugImages);
            }
            // 同步到 quickJson 並儲存
            quickJson.value = JSON.stringify(storageData, null, 2);
            localStorage.setItem('lastJsonData', quickJson.value);

            window.showDebugButton = true; // Enable debug for new recognition
            renderResult(data);

            // 新增：加入歷史紀錄
            if (typeof addToHistory === 'function') {
                addToHistory(data);
            }
        } catch (e) {
            console.error("JSON 解析失敗", e);
        }
    }
}

// 輔助函式
function showMessage(msg) { console.log(msg); }

const layoutToggle = document.getElementById('layoutToggle');
layoutToggle.addEventListener('click', () => {
    currentLayout = currentLayout === 'landscape' ? 'portrait' : 'landscape';
    layoutToggle.textContent = currentLayout === 'landscape' ? '💻' : '📱';

    // 如果當前是在聲骸頁面或歷史紀錄頁面，不觸發 renderResult (因為會強制切換回主頁面)
    const echoPageSection = document.getElementById('echoPageSection');
    const historySection = document.getElementById('historySection');

    if (echoPageSection && echoPageSection.style.display !== 'none') {
        return;
    }
    if (historySection && historySection.style.display !== 'none') {
        return;
    }

    renderResult();
});

// Chain Selection Logic
function openChainModal() {
    const modal = document.getElementById('chainSelectModal');
    if (modal) modal.classList.add('show');
}

function closeChainModal() {
    const modal = document.getElementById('chainSelectModal');
    if (modal) modal.classList.remove('show');
}

function selectChain(level) {
    let data = window.currentJsonResult;
    if (!data) return;

    data.NumberOfStars = level;
    recalculateScore(data);

    if (jsonOutput) jsonOutput.value = JSON.stringify(data, null, 2);
    if (quickJson) {
        quickJson.value = JSON.stringify(data, null, 2);
        localStorage.setItem('lastJsonData', quickJson.value);
    }

    renderResult(data);
    closeChainModal();
}

// Helper to crop image as base64
function cropImageAsBase64(x, y, w, h) {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext('2d');
    const imageData = ctx.getImageData(x, y, w, h);
    tempCtx.putImageData(imageData, 0, 0);
    return tempCanvas.toDataURL();
}

// Debug Modal Logic
const debugModal = document.getElementById('debugModal');
let currentDebugEchoIndex = -1;

document.addEventListener('click', (e) => {
    let target = e.target;
    if (target && target.nodeType === 3) target = target.parentNode; // 處理文字節點
    if (target && target.closest && target.closest('#closeDebugModalBtn')) {
        const modal = document.getElementById('debugModal');
        if (modal) modal.classList.remove('show');
    }
});

window.addEventListener('click', (event) => {
    const modal = document.getElementById('debugModal');
    if (modal && event.target == modal) {
        modal.classList.remove('show');
    }
});

// 位元壓縮函數：將二值化資料壓縮成位元串
function compressBinaryData(binaryData) {
    const pixelCount = binaryData.length / 4; // RGBA，每個像素4個值
    const byteCount = Math.ceil(pixelCount / 8); // 每8個像素需要1個byte
    const compressed = new Uint8Array(byteCount);

    for (let i = 0; i < pixelCount; i++) {
        const byteIndex = Math.floor(i / 8);
        const bitIndex = 7 - (i % 8); // 從高位到低位
        const pixelValue = binaryData[i * 4]; // 取R值（二值化後RGB都相同）

        if (pixelValue === 255) { // 白色像素設為1
            compressed[byteIndex] |= (1 << bitIndex);
        }
        // 黑色像素為0，不需設置（預設就是0）
    }

    return compressed;
}

function openDebugModal(index) {
    currentDebugEchoIndex = index;
    const echo = window.currentJsonResult.list[index];
    if (!echo || !echo.DebugImages) {
        alert('此聲骸沒有除錯影像資料 (可能是舊資料或未開啟除錯模式)');
        return;
    }

    const content = document.getElementById('debugContent');
    content.innerHTML = '';

    const createRow = (label, items) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '10px';
        row.style.background = 'rgba(255,255,255,0.05)';
        row.style.padding = '8px';
        row.style.borderRadius = '8px';
        row.style.marginBottom = '8px';

        const labelDiv = document.createElement('div');
        labelDiv.style.width = '80px';
        labelDiv.style.flexShrink = '0';
        labelDiv.style.fontWeight = 'bold';
        labelDiv.style.color = 'var(--accent-blue)';
        labelDiv.textContent = label;
        row.appendChild(labelDiv);

        const itemsContainer = document.createElement('div');
        itemsContainer.style.flex = '1';
        itemsContainer.style.display = 'flex';
        itemsContainer.style.gap = '10px';

        items.forEach(item => {
            const itemDiv = document.createElement('div');
            itemDiv.style.flex = '1';
            itemDiv.style.display = 'flex';
            itemDiv.style.alignItems = 'center';
            itemDiv.style.justifyContent = 'space-between';
            itemDiv.style.background = 'rgba(0,0,0,0.2)';
            itemDiv.style.padding = '5px 10px';
            itemDiv.style.borderRadius = '4px';

            const contentLeft = document.createElement('div');
            contentLeft.style.display = 'flex';
            contentLeft.style.alignItems = 'center';
            contentLeft.style.gap = '8px';

            if (item.img) {
                const img = document.createElement('img');
                img.src = item.img;
                img.style.height = '30px';
                img.style.maxWidth = '120px';
                img.style.objectFit = 'contain';
                img.style.border = '1px solid #555';
                contentLeft.appendChild(img);
            }

            const text = document.createElement('span');
            text.textContent = item.text;
            text.style.color = 'var(--text-primary)';
            contentLeft.appendChild(text);

            itemDiv.appendChild(contentLeft);

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'debug-checkbox';
            checkbox.dataset.info = `${label}: ${item.text}`;
            checkbox.dataset.type = item.type;
            checkbox.dataset.imgSrc = item.img || '';
            checkbox.style.width = '18px';
            checkbox.style.height = '18px';
            checkbox.style.cursor = 'pointer';
            itemDiv.appendChild(checkbox);

            itemsContainer.appendChild(itemDiv);
        });

        row.appendChild(itemsContainer);
        return row;
    };

    // 1. 屬性 & Cost
    content.appendChild(createRow('屬性 & Cost', [
        { img: echo.DebugImages.Attribute, text: echo.Attributes, type: '屬性' },
        { img: echo.DebugImages.Cost, text: echo.Cost, type: 'Cost' }
    ]));

    // 2. 主詞條
    content.appendChild(createRow('主詞條', [
        { img: echo.DebugImages.MainAffix, text: `${echo.AllEchoAffix[0].Name} ${echo.AllEchoAffix[0].Number}`, type: '主詞條' }
    ]));

    // 3-7. 副詞條
    for (let i = 1; i <= 5; i++) {
        const affix = echo.AllEchoAffix[i];
        const debugImg = echo.DebugImages.SubAffixes[i - 1]; // Array is 0-indexed
        if (affix && debugImg) {
            content.appendChild(createRow(`副詞條 ${i}`, [
                { img: debugImg.Name, text: affix.Name, type: `副詞條名稱${i}` },
                { img: debugImg.Value, text: affix.Number, type: `副詞條數值${i}` }
            ]));
        }
    }

    const modal = document.getElementById('debugModal');
    if (modal) modal.classList.add('show');
}

document.addEventListener('click', async (e) => {
    let target = e.target;
    if (target && target.nodeType === 3) target = target.parentNode; // 處理文字節點
    const btn = target && target.closest ? target.closest('#reportDebugBtn') : null;
    if (btn) {
        const checkboxes = document.querySelectorAll('.debug-checkbox:checked');
        if (checkboxes.length === 0) {
            alert('請先選擇要回報的項目');
            return;
        }

        btn.disabled = true;
        btn.textContent = '回報中...';

        try {
            const echoIndex = currentDebugEchoIndex + 1;
            const promises = Array.from(checkboxes).map(async (cb) => {
                const type = cb.dataset.type;
                const imgSrc = cb.dataset.imgSrc;

                if (!imgSrc) return;

                // Load image
                const img = new Image();
                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                    img.src = imgSrc;
                });

                // Draw to canvas to get data
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const data = imageData.data;

                // Binarize
                const threshold = 128;
                // 屬性為正常二值化，其餘為反向二值化
                const isInverted = type !== '屬性';
                const binaryData = [];

                for (let j = 0; j < data.length; j += 4) {
                    const gray = (data[j] + data[j + 1] + data[j + 2]) / 3;
                    let binary;
                    if (isInverted) {
                        binary = gray > threshold ? 0 : 255; // 反向二值化
                    } else {
                        binary = gray > threshold ? 255 : 0; // 正常二值化
                    }
                    binaryData.push(binary, binary, binary, 255); // RGBA
                }

                // Compress
                const compressed = compressBinaryData(binaryData);
                const base64Data = btoa(String.fromCharCode(...compressed));

                const jsonPayload = JSON.stringify({
                    width: img.width,
                    height: img.height,
                    data: base64Data
                });

                // Submit to Google Form
                const formUrl = 'https://docs.google.com/forms/d/e/1FAIpQLSfVvcNkgBJRAQclBLfX52q8sXDW-18d8VR_WcFEMF94KBpZoA/formResponse';
                const formData = new FormData();
                formData.append('entry.1969451592', echoIndex); // 聲骸位置
                formData.append('entry.705372311', type);       // 辨識位置
                formData.append('entry.71631029', jsonPayload); // 2值化資料

                await fetch(formUrl, {
                    method: 'POST',
                    mode: 'no-cors',
                    body: formData
                });
            });

            await Promise.all(promises);
            alert('已完成回報');

            // Uncheck all
            checkboxes.forEach(cb => cb.checked = false);
            const modal = document.getElementById('debugModal');
            if (modal) modal.classList.remove('show');

        } catch (error) {
            console.error('回報失敗:', error);
            alert('回報失敗: ' + error.message);
        } finally {
            btn.disabled = false;
            btn.textContent = '回報';
        }
    }
});

// Expose functions to global scope for HTML onclick
window.openChainModal = openChainModal;
window.closeChainModal = closeChainModal;
window.selectChain = selectChain;

window.showDebugButton = true; // Global flag to control debug button visibility

function renderResult(inputData) {
    // 切換顯示狀態：顯示主內容，隱藏歷史紀錄與聲骸頁面
    const historySection = document.getElementById('historySection');
    const mainContent = document.getElementById('mainContent');
    const echoPageSection = document.getElementById('echoPageSection');
    const rankSection = document.getElementById('rankSection');

    if (rankSection) rankSection.style.display = 'none';
    if (historySection) historySection.style.display = 'none';
    if (echoPageSection) echoPageSection.style.display = 'none';
    if (mainContent) mainContent.style.display = 'block';

    let data = inputData;
    if (!data) {
        try {
            let raw = '';
            const quickVal = (typeof quickJson !== 'undefined' && quickJson && quickJson.value) ? quickJson.value.trim() : '';
            if (quickVal) {
                raw = quickVal;
            } else if (AUTO_LOAD_FROM_LOCAL) {
                raw = localStorage.getItem('lastJsonData') || '';
            } else {
                raw = '';
            }

            if (!raw) {
                mainContent.innerHTML = '';
                noDataMessage.style.display = '';
                return;
            }
            data = JSON.parse(raw);
        } catch (e) { console.error("Data parse error", e); noDataMessage.style.display = ''; mainContent.innerHTML = ''; return; }
    }

    // 更新全域變數，供更換功能使用
    window.currentJsonResult = data;

    // 更新全域列表，供匯出功能使用
    if (data && data.list) {
        allEchoList = data.list;
    } else {
        allEchoList = [];
    }

    const stars = Array(6).fill().map((_, i) =>
        `<svg class="star ${i < (data.NumberOfStars || 0) ? '' : 'empty'}" viewBox="0 0 24 24">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>`
    ).join('');

    const totalScore = parseFloat(data.Total總分) || 0;
    const totalScoreHTML = `<div class="stat-value">${totalScore.toFixed(2)}</div>`;
    let damageStatsHtml = '';
    if (typeof resonatorData !== 'undefined' && resonatorData[data.Name] && resonatorData[data.Name][data.NumberOfStars]) {
        const weights = resonatorData[data.Name][data.NumberOfStars];
        const stats = [
            { key: 'NormalAttack', label: '普攻傷害' },
            { key: 'HeavyAttack', label: '重擊傷害' },
            { key: 'SecretWeapon', label: '共鳴解放傷害' },
            { key: 'Skills', label: '共鳴技能傷害' },
            { key: 'Other', label: '其他' }
        ];

        const statsParts = [];

        // Map to get values and filter valid ones
        const validStats = stats.map(stat => {
            const val = weights[stat.key];
            return { ...stat, val };
        }).filter(item => item.val !== undefined && item.val !== null);

        // Sort by value descending
        validStats.sort((a, b) => parseFloat(b.val) - parseFloat(a.val));

        validStats.forEach(item => {
            statsParts.push(`
                        <div style="
                            display: inline-flex; 
                            align-items: center; 
                            background: rgba(255, 255, 255, 0.08); 
                            border: 1px solid rgba(255, 255, 255, 0.1); 
                            border-radius: 4px; 
                            padding: 2px 6px; 
                            font-size: 0.75rem; 
                            color: #bbb;
                            white-space: nowrap;
                        ">
                            <span style="margin-right: 4px;">${item.label}:</span>
                            <span style="color: #ffd700; font-weight: bold;">${item.val}%</span>
                        </div>
                    `);
        });
        if (statsParts.length > 0) {
            damageStatsHtml = `<div style="display: flex; flex-wrap: wrap; gap: 6px; margin-left: 10px;">${statsParts.join('')}</div>`;
        }
    }

    const exportBtnHtml = `<button id="openModalBtn" class="file-btn" style="padding: 4px 12px; font-size: 0.8rem; min-width: auto; height: auto; border-width: 1px; margin-left: 10px;">匯出</button>`;

    const uidDisplay = `<div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                ${data.UID ? `<div class="character-uid">${data.UID}</div>` : ''}
                ${damageStatsHtml}
            </div>`;

    let equipmentCards = '';
    if (Array.isArray(data.list) && data.list.length > 0) {
        data.list.forEach((item, index) => {
            const filteredAffixes = (item.AllEchoAffix || [])
                .filter(affix => affix.Id !== 0);

            const itemScore = parseFloat(item.Points) || 0;
            let itemScoreColor = itemScore >= 8 ? 'score-high' : (itemScore < 5 ? 'score-low' : 'score-medium');
            const costVal = item.Cost || 1;

            let shortName = item.Attributes || '聲骸';
            const attrPic = attributesProfilePicture[shortName];
            let attrDisplay = attrPic
                ? `<img src="${attrPic}" title="${shortName}" style="width: 24px; height: 24px; object-fit: contain; vertical-align: middle;">`
                : shortName;

            let affixRows = filteredAffixes.map(affix => {
                const pts = parseFloat(affix.Points) || 0;
                const ptClass = pts > 0 ? 'point-pos' : 'point-zero';
                const name = affix.Name;
                return `<tr><td class="affix-name">${name}</td><td class="affix-value">${affix.Number}</td><td class="affix-point ${ptClass}">${pts.toFixed(2)}</td></tr>`;
            }).join('');

            const debugBtnHtml = window.showDebugButton ? `<button class="chain-badge" style="padding: 0 6px; font-size: 0.8rem; height: 24px; margin-left: 5px; background: var(--accent-red); color: white; border: 1px solid var(--accent-red); cursor: pointer;" onclick="openDebugModal(${index})" title="除錯">!</button>` : '';

            equipmentCards += `
                        <div class="equipment-card fade-in-up" style="animation-delay: ${index * 0.05}s">
                            <div class="equipment-header-row">
                                <span class="cost-num cost-${costVal}">${costVal}</span>
                                <span class="echo-name">${attrDisplay}</span>
                                <button class="switch-btn" style="padding: 2px 8px; font-size: 0.8rem; height: 24px; margin: 0 5px;" onclick="openReplaceModal(${index})">更換</button>
                                <span class="echo-score ${itemScoreColor}">${itemScore.toFixed(2)}</span>
                                ${debugBtnHtml}
                            </div>
                            <table class="affix-table">${affixRows}</table>
                        </div>
                    `;
        });
    }

    let layoutHTML = '';
    // const chainBadge = `<span class="chain-badge" onclick="openChainModal()" title="點擊修改共鳴鏈">${data.NumberOfStars || 0}</span>`;

    if (currentLayout === 'portrait') {
        const profilePicUrl = resonatorsProfilePicture[data.Name || ''];
        layoutHTML = `
                    <div class="portrait-layout">
                        <div class="character-card">
                            ${profilePicUrl ? `<img src="${profilePicUrl}" class="character-avatar" onclick="openChainModal()" style="cursor: pointer;" title="點擊修改共鳴鏈">` : `<div class="character-avatar" style="background:#333; cursor: pointer;" onclick="openChainModal()" title="點擊修改共鳴鏈"></div>`}
                            <div class="character-info">
                                <div style="display: flex; align-items: center; flex-wrap: wrap; margin-bottom: 0.2rem;">
                                    <h1 style="margin-bottom: 0;">${data.Name || '未知'}</h1>
                                    ${exportBtnHtml}
                                </div>
                                <div class="character-stars">${stars}</div>
                                ${uidDisplay}
                            </div>
                            <div class="stats-grid">${totalScoreHTML}</div>
                        </div>
                        <div class="equipment-grid portrait">${equipmentCards}</div>
                    </div>
                `;
    } else {
        const profilePicUrl = resonatorsProfilePicture[data.Name || ''];
        layoutHTML = `
                    <div class="landscape-layout">
                        <div class="character-card">
                            <div class="character-header">
                                <div class="avatar-container">
                                    ${profilePicUrl ? `<img src="${profilePicUrl}" class="character-avatar" onclick="openChainModal()" style="cursor: pointer;" title="點擊修改共鳴鏈">` : `<div class="character-avatar" style="background:#333; cursor: pointer;" onclick="openChainModal()" title="點擊修改共鳴鏈"></div>`}
                                    <div class="character-stars">${stars}</div>
                                </div>
                                <div class="character-info">
                                    <div style="display: flex; align-items: center; flex-wrap: wrap; margin-bottom: 0.5rem;">
                                        <h1 style="margin-bottom: 0;">${data.Name || '未知角色'}</h1>
                                        ${exportBtnHtml}
                                    </div>
                                    ${uidDisplay}
                                </div>
                            </div>
                            <div class="stats-grid">${totalScoreHTML}</div>
                        </div>
                        <div class="equipment-section">
                            <div class="equipment-grid landscape">${equipmentCards}</div>
                        </div>
                    </div>
                `;
    }

    mainContent.innerHTML = layoutHTML;
    noDataMessage.style.display = 'none';
}

if (quickJson) {
    quickJson.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = this.value.trim();
            if (!val) return;
            try {
                const parsed = JSON.parse(val);
                const pretty = JSON.stringify(parsed, null, 2);
                localStorage.setItem('lastJsonData', pretty);
                window.showDebugButton = false; // Disable debug for manual JSON input
                renderResult();
                this.select();
            } catch (err) {
                alert('貼上的 JSON 無效，請檢查格式。');
                this.select();
            }
        }
    });
}
document.addEventListener('keydown', function (e) { if (e.ctrlKey && e.key === 'Enter') renderResult(); });

if (AUTO_LOAD_FROM_LOCAL) {
    renderResult();
} else {
    mainContent.innerHTML = '';
    noDataMessage.style.display = '';
}

// ==================================================================================
// 匯出工具邏輯 (整合自 DialogExportData.html)
// ==================================================================================

// const openModalBtn = document.getElementById('openModalBtn'); // Removed static button
const exportModal = document.getElementById('exportModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const targetFileInputModal = document.getElementById('targetFileInputModal');
const roleSelectModal = document.getElementById('roleSelectModal');
const exportBtnModal = document.getElementById('exportBtnModal');
const modalMessage = document.getElementById('modalMessage');

// Modal 控制
document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'openModalBtn') {
        exportModal.classList.add('show');
        updateSourceInfo();
    }
});

closeModalBtn.addEventListener('click', () => {
    exportModal.classList.remove('show');
});

exportModal.addEventListener('click', (e) => {
    if (e.target === exportModal) {
        exportModal.classList.remove('show');
    }
});

// 更新來源資訊
function updateSourceInfo() {
    const sourceInfo = document.getElementById('sourceInfo');
    if (allEchoList && allEchoList.length > 0) {
        // 嘗試從 window.currentJsonResult 或 jsonOutput 或 quickJson 獲取完整數據以顯示角色名稱等
        let data = window.currentJsonResult || {};

        if (!data.Name) {
            try {
                const val = jsonOutput.value || (quickJson ? quickJson.value : '');
                if (val) data = JSON.parse(val);
            } catch (e) { }
        }

        document.getElementById('characterName').textContent = data.Name || 'N/A';
        document.getElementById('uid').textContent = data.UID || 'N/A';
        document.getElementById('chainNum').textContent = data.NumberOfStars || 0;
        document.getElementById('echoCount').textContent = allEchoList.length;
        checkCanExportModal();
    } else {
        document.getElementById('characterName').textContent = '尚未載入';
        document.getElementById('uid').textContent = '尚未載入';
        document.getElementById('chainNum').textContent = '0';
        document.getElementById('echoCount').textContent = '0';
    }
}

// 載入目標 JSON 檔案
targetFileInputModal.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
        targetFileName = file.name;
        const text = await file.text();
        targetData = JSON.parse(text);

        // 填充角色選單
        roleSelectModal.innerHTML = '';
        if (targetData.role && Array.isArray(targetData.role)) {
            targetData.role.forEach((role, index) => {
                const option = document.createElement('option');
                option.value = index;
                option.textContent = role.name || `角色 ${index + 1}`;
                roleSelectModal.appendChild(option);
            });
            roleSelectModal.disabled = false;
            if (targetData.role.length > 0) {
                roleSelectModal.selectedIndex = 0;
            }
            showModalMessage('目標檔案載入成功', 'success');
        } else {
            showModalMessage('目標檔案中沒有角色數據', 'error');
        }

        checkCanExportModal();
    } catch (error) {
        showModalMessage('讀取目標檔案失敗：' + error.message, 'error');
        console.error(error);
    }
});

// 匯出數據
exportBtnModal.addEventListener('click', () => {
    if (!allEchoList || allEchoList.length === 0 || !targetData) {
        showModalMessage('請先載入所有必要檔案', 'error');
        return;
    }

    const roleIndex = parseInt(roleSelectModal.value);
    if (isNaN(roleIndex) || !targetData.role[roleIndex]) {
        showModalMessage('請選擇有效的角色', 'error');
        return;
    }

    const role = targetData.role[roleIndex];

    // 檢查聲骸數量
    if (!role.costList || role.costList.length < 5) {
        showModalMessage('聲骸數量未滿無法替換', 'error');
        return;
    }

    if (allEchoList.length < 5) {
        showModalMessage('來源聲骸數據不足 5 個', 'error');
        return;
    }

    try {
        // 替換數據
        for (let i = 0; i < role.costList.length && i < allEchoList.length; i++) {
            if (role.costList[i].propertyList) {
                // 副詞條列表
                role.costList[i].propertyList = getPropertyList(allEchoList[i]);

                // 消耗類型
                role.costList[i].type = getCostType(allEchoList[i].Cost);

                // 套裝
                role.costList[i].suite = getTCtoCNAttributes(allEchoList[i].Attributes);

                // 主詞條
                role.costList[i].mainAtrri = getMainAttr(allEchoList[i]);
            }
        }

        // 下載檔案
        const updatedJson = JSON.stringify(targetData, null, 2);
        downloadFile(updatedJson, targetFileName);

        showModalMessage('資料已成功匯出', 'success');
    } catch (error) {
        showModalMessage('匯出失敗：' + error.message, 'error');
        console.error(error);
    }
});

function checkCanExportModal() {
    exportBtnModal.disabled = !(allEchoList && allEchoList.length > 0 && targetData && !roleSelectModal.disabled);
}

function showModalMessage(text, type) {
    modalMessage.textContent = text;
    modalMessage.className = `message ${type} show`;
    modalMessage.style.display = 'block';
    setTimeout(() => {
        modalMessage.style.display = 'none';
        modalMessage.classList.remove('show');
    }, 5000);
}

function downloadFile(content, filename) {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// 輔助轉換函式
function getPropertyList(echo) {
    const properties = [];
    // 索引 1-5 是副詞條
    for (let i = 1; i <= 5; i++) {
        if (echo.AllEchoAffix[i]) {
            properties.push(getProperty(echo.AllEchoAffix[i]));
        }
    }
    return properties;
}

function getProperty(echoAffix) {
    return {
        property: supTCtoCN(echoAffix),
        value: echoAffix.Number
    };
}


function getMainAttr(echo) {
    if (echo.AllEchoAffix[0]) {
        return mainTCtoCN(echo.AllEchoAffix[0].Name) + echo.AllEchoAffix[0].Number;
    }
    return '';
}
// ==================================================================================
// 歷史紀錄邏輯
// ==================================================================================

const openHistoryBtn = document.getElementById('openHistoryBtn');
const historySection = document.getElementById('historySection');
const closeHistorySectionBtn = document.getElementById('closeHistorySectionBtn');
const historyTableBody = document.getElementById('historyTableBody');
const historyMessage = document.getElementById('historyMessage');

// Section 控制
if (openHistoryBtn) {
    openHistoryBtn.addEventListener('click', () => {
        if (historySection.style.display === 'none') {
            historySection.style.display = 'block';
            renderHistoryList();
            // 滾動到歷史紀錄區域
            historySection.scrollIntoView({ behavior: 'smooth' });
        } else {
            historySection.style.display = 'none';
        }
    });
}

// 預設顯示歷史紀錄
if (historySection) {
    historySection.style.display = 'block';
    renderHistoryList();
}

if (closeHistorySectionBtn) {
    closeHistorySectionBtn.addEventListener('click', () => {
        historySection.style.display = 'none';
    });
}

// 儲存歷史紀錄
function addToHistory(data) {
    if (!data || !data.UID) return; // 必須有 UID

    // 複製資料並剔除影像資料以節省空間
    const dataToStore = JSON.parse(JSON.stringify(data));
    if (dataToStore.list) {
        dataToStore.list.forEach(echo => delete echo.DebugImages);
    }

    let history = getHistory();

    // 檢查重複 (UID + 角色名稱 + 總分)
    // 如果存在相同 UID、角色名稱且分數相近的紀錄，則視為同一筆資料的更新
    const duplicateIndex = history.findIndex(item => {
        return item.uid === dataToStore.UID &&
            item.name === dataToStore.Name &&
            Math.abs(item.score - dataToStore.Total總分) < 0.01;
    });

    if (duplicateIndex !== -1) {
        // 移除舊的紀錄，以便將新的紀錄加入到最前面
        history.splice(duplicateIndex, 1);
    }

    const newItem = {
        uid: dataToStore.UID,
        name: dataToStore.Name,
        score: dataToStore.Total總分,
        timestamp: Date.now(),
        data: dataToStore
    };

    history.unshift(newItem); // 加入到最前面

    // 限制數量 (例如 50 筆)
    if (history.length > 50) {
        history = history.slice(0, 50);
    }

    localStorage.setItem('recognitionHistory', JSON.stringify(history));
}

function getHistory() {
    try {
        const stored = localStorage.getItem('recognitionHistory');
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        console.error('讀取歷史紀錄失敗', e);
        return [];
    }
}

function renderHistoryList() {
    const history = getHistory();
    historyTableBody.innerHTML = '';

    if (history.length === 0) {
        historyTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">尚無紀錄</td></tr>';
        return;
    }

    history.forEach((item, index) => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #333';

        // const date = new Date(item.timestamp).toLocaleString();

        tr.innerHTML = `
                    <td style="padding: 10px;">${item.uid}</td>
                    <td style="padding: 10px;">${item.name}</td>
                    <td style="padding: 10px; color: var(--accent-gold); font-weight: bold;">${item.score}</td>
                    <td style="padding: 10px; white-space: nowrap;">
                        <button class="switch-btn" style="display: inline-flex; padding: 5px 10px; font-size: 0.8rem; margin-right: 5px;" onclick="loadHistoryItem(${index})">載入</button>
                        <button class="switch-btn" style="display: inline-flex; padding: 5px 10px; font-size: 0.8rem; background: var(--accent-red); border-color: var(--accent-red);" onclick="deleteHistoryItem(${index})">刪除</button>
                    </td>
                `;
        historyTableBody.appendChild(tr);
    });
}

// 全域函式供 HTML onclick 使用
window.showHistorySection = function () {
    const historySection = document.getElementById('historySection');
    const mainContent = document.getElementById('mainContent');
    const rankSection = document.getElementById('rankSection');
    const echoPageSection = document.getElementById('echoPageSection');

    if (rankSection) rankSection.style.display = 'none';
    if (echoPageSection) echoPageSection.style.display = 'none';
    if (historySection) {
        historySection.style.display = 'block';
        if (mainContent) mainContent.style.display = 'none';
        renderHistoryList();
        historySection.scrollIntoView({ behavior: 'smooth' });
    }
};

window.loadHistoryItem = function (index) {
    const history = getHistory();
    if (history[index]) {
        const data = history[index].data;

        // --- 自動新增 UID 與聲骸邏輯 ---
        if (data.UID) {
            // 1. 自動新增 UID
            const uids = getUidList();
            if (!uids.includes(data.UID)) {
                uids.push(data.UID);
                uids.sort();
                saveUidList(uids);
                updateEchoPageUidSelector();
            }

            // 2. 自動匯入聲骸資料
            if (data.list && Array.isArray(data.list)) {
                const existingData = getEchoDataByUid(data.UID);
                let echoAdded = 0;

                data.list.forEach(newEcho => {
                    const newEchoNormalized = normalizeForComparison(newEcho);
                    const exists = existingData.some(existEcho => {
                        return normalizeForComparison(existEcho) === newEchoNormalized;
                    });

                    if (!exists) {
                        // 儲存前將評分歸零
                        const echoToSave = JSON.parse(JSON.stringify(newEcho));
                        echoToSave.Points = 0;
                        if (echoToSave.AllEchoAffix) {
                            echoToSave.AllEchoAffix.forEach(a => a.Points = 0);
                        }
                        existingData.push(echoToSave);
                        echoAdded++;
                    }
                });

                if (echoAdded > 0) {
                    saveEchoDataByUid(data.UID, existingData);
                    console.log(`[載入紀錄] 已自動新增 ${echoAdded} 個聲骸至 UID: ${data.UID}`);
                }
            }
        }
        // -----------------------------

        // 更新 UI
        if (quickJson) {
            quickJson.value = JSON.stringify(data, null, 2);
            localStorage.setItem('lastJsonData', quickJson.value);
        }

        window.showDebugButton = false; // Disable debug for history items
        renderResult(data);

        // 關閉 Section
        const historySection = document.getElementById('historySection');
        if (historySection) {
            historySection.style.display = 'none';
        }

        // 滾動到頂部
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
};

window.deleteHistoryItem = function (index) {
    if (!confirm('確定要刪除此紀錄嗎？')) return;

    let history = getHistory();
    history.splice(index, 1);
    localStorage.setItem('recognitionHistory', JSON.stringify(history));
    renderHistoryList();
};

// 匯入/匯出歷史紀錄
const importHistoryBtn = document.getElementById('importHistoryBtn');
const exportHistoryBtn = document.getElementById('exportHistoryBtn');
const historyFileInput = document.getElementById('historyFileInput');

if (importHistoryBtn) {
    importHistoryBtn.addEventListener('click', () => {
        historyFileInput.click();
    });
}

if (historyFileInput) {
    historyFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const importedData = JSON.parse(text);

            if (!Array.isArray(importedData)) {
                alert('匯入格式錯誤：必須是歷史紀錄陣列');
                return;
            }

            let currentHistory = getHistory();
            let addedCount = 0;
            let totalEchoesAdded = 0;
            let lastImportedUid = null;

            importedData.forEach(item => {
                // 僅支援 UserData.json 格式 (必須包含 UID)
                if (!item.UID) return;

                lastImportedUid = item.UID;

                // --- 自動新增 UID 與聲骸邏輯 ---
                // 1. 自動新增 UID
                const uids = getUidList();
                if (!uids.includes(item.UID)) {
                    uids.push(item.UID);
                    uids.sort();
                    saveUidList(uids);
                    updateEchoPageUidSelector();
                }

                // 2. 自動匯入聲骸資料
                if (item.list && Array.isArray(item.list)) {
                    const existingData = getEchoDataByUid(item.UID);
                    let echoAdded = 0;

                    item.list.forEach(newEcho => {
                        // 檢查副詞條：如果有名字沒數值，或有數值沒名字，則視為無效
                        if (newEcho.AllEchoAffix && Array.isArray(newEcho.AllEchoAffix)) {
                            let isInvalid = false;
                            for (let i = 1; i < newEcho.AllEchoAffix.length; i++) {
                                const affix = newEcho.AllEchoAffix[i];
                                const hasName = affix.Name && affix.Name !== "";
                                const hasNumber = affix.Number && affix.Number !== "";

                                if (hasName !== hasNumber) {
                                    isInvalid = true;
                                    break;
                                }
                            }
                            if (isInvalid) return;
                        }

                        const newEchoNormalized = normalizeForComparison(newEcho);
                        const exists = existingData.some(existEcho => {
                            return normalizeForComparison(existEcho) === newEchoNormalized;
                        });

                        if (!exists) {
                            // 儲存前將評分歸零
                            const echoToSave = JSON.parse(JSON.stringify(newEcho));
                            delete echoToSave.DebugImages;
                            echoToSave.Points = 0;
                            if (echoToSave.AllEchoAffix) {
                                echoToSave.AllEchoAffix.forEach(a => a.Points = 0);
                            }
                            existingData.push(echoToSave);
                            echoAdded++;
                        }
                    });

                    if (echoAdded > 0) {
                        saveEchoDataByUid(item.UID, existingData);
                        totalEchoesAdded += echoAdded;
                    }
                }
                // -----------------------------

                const dataObj = item;
                const timestamp = Date.now();

                // 建構內部儲存格式
                const newItem = {
                    uid: dataObj.UID,
                    name: dataObj.Name,
                    score: parseFloat(dataObj.Total總分 || 0),
                    timestamp: timestamp,
                    data: dataObj
                };

                // 檢查重複 (UID + 角色名稱 + 總分)
                const duplicateIndex = currentHistory.findIndex(existItem => {
                    return existItem.uid === newItem.uid &&
                        existItem.name === newItem.name &&
                        Math.abs(existItem.score - newItem.score) < 0.01;
                });

                if (duplicateIndex === -1) {
                    currentHistory.unshift(newItem);
                    addedCount++;
                }
            });

            // 依時間排序 (如果有 timestamp)
            currentHistory.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

            localStorage.setItem('recognitionHistory', JSON.stringify(currentHistory));
            renderHistoryList();

            // 如果當前在聲骸頁面，重新渲染列表
            if (echoPageSection.style.display === 'block') {
                renderEchoList();
            }

            alert(`成功匯入 ${addedCount} 筆紀錄，並新增了 ${totalEchoesAdded} 個聲骸資料`);

            // 自動選擇最後匯入的 UID
            if (lastImportedUid) {
                updateEchoPageUidSelector();
                echoPageUidSelector.value = lastImportedUid;
                renderEchoList();
                updateSetFilterButtons();

                // 更新按鈕顯示狀態
                const hasUid = !!echoPageUidSelector.value;
                const importBtn = document.getElementById('echoPageImportBtn');
                const exportBtn = document.getElementById('echoPageExportDataBtn');
                const importDataBtn = document.getElementById('echoPageImportDataBtn');

                if (importBtn) importBtn.style.display = hasUid ? 'inline-block' : 'none';
                if (exportBtn) exportBtn.style.display = hasUid ? 'inline-block' : 'none';
                if (importDataBtn) importDataBtn.style.display = hasUid ? 'inline-block' : 'none';
            }

            // 重置輸入
            historyFileInput.value = '';
        } catch (err) {
            console.error(err);
            alert('匯入失敗：' + err.message);
        }
    });
}

if (exportHistoryBtn) {
    exportHistoryBtn.addEventListener('click', () => {
        const history = getHistory();
        if (history.length === 0) {
            alert('沒有紀錄可匯出');
            return;
        }
        // 轉換為 UserData.json 格式 (只匯出 data 部分)
        const exportData = history.map(item => item.data);
        const jsonStr = JSON.stringify(exportData, null, 2);
        downloadFile(jsonStr, `echo_history_${new Date().toISOString().slice(0, 10)}.json`);
    });
}

// ==================================================================================
// UID 管理與聲骸資料庫邏輯 (移至聲骸頁面)
// ==================================================================================

const echoPageSection = document.getElementById('echoPageSection');
const echoPageUidSelector = document.getElementById('echoPageUidSelector');
const echoPageAddUidBtn = document.getElementById('echoPageAddUidBtn');
const echoPageDeleteUidBtn = document.getElementById('echoPageDeleteUidBtn');
const echoListTableBody = document.getElementById('echoListTableBody');
const echoBtn = document.getElementById('echoBtn');
const homeBtn = document.getElementById('homeBtn');

// 篩選變數
let currentCostFilter = 'all';
let currentSetFilter = 'all';

// 初始化
updateEchoPageUidSelector();
updateSetFilterButtons();

// 頁面切換邏輯
if (echoBtn) {
    echoBtn.addEventListener('click', () => {
        // 隱藏主內容與歷史紀錄
        if (mainContent) mainContent.style.display = 'none';
        if (historySection) historySection.style.display = 'none';

        // 隱藏排行榜頁面
        const rankSection = document.getElementById('rankSection');
        if (rankSection) rankSection.style.display = 'none';

        // 顯示聲骸頁面
        if (echoPageSection) {
            echoPageSection.style.display = 'block';
            renderEchoList(); // 渲染當前 UID 的聲骸列表
            updateSetFilterButtons();
        }
    });
}

if (homeBtn) {
    // 修改 homeBtn 行為：顯示主內容，隱藏聲骸頁面
    // 原本的 onclick="showHistorySection()" 可能會衝突，這裡覆蓋或補充
    homeBtn.onclick = (e) => {
        e.preventDefault(); // 防止預設行為
        const rankSection = document.getElementById('rankSection');
        if (rankSection) rankSection.style.display = 'none';
        if (echoPageSection) echoPageSection.style.display = 'none';
        if (historySection) historySection.style.display = 'block'; // 根據需求，首頁可能顯示歷史紀錄或主內容
        // 如果要顯示主內容：
        // if (mainContent) mainContent.style.display = 'block';
        // 根據原程式碼，homeBtn 呼叫 showHistorySection()，所以這裡保持一致
        showHistorySection();
    };
}

// 載入 UID 列表
function getUidList() {
    try {
        const list = localStorage.getItem('uidList');
        return list ? JSON.parse(list) : [];
    } catch (e) {
        return [];
    }
}

// 儲存 UID 列表
function saveUidList(list) {
    localStorage.setItem('uidList', JSON.stringify(list));
}

// 取得特定 UID 的聲骸資料
function getEchoDataByUid(uid) {
    try {
        const data = localStorage.getItem(`echoData_${uid}`);
        return data ? JSON.parse(data) : [];
    } catch (e) {
        return [];
    }
}

// 儲存特定 UID 的聲骸資料
function saveEchoDataByUid(uid, data) {
    localStorage.setItem(`echoData_${uid}`, JSON.stringify(data));
}

// 更新下拉選單
function updateEchoPageUidSelector() {
    const uids = getUidList();
    const current = echoPageUidSelector.value;

    echoPageUidSelector.innerHTML = '<option value="">未選擇 (預設)</option>';
    uids.forEach(uid => {
        const option = document.createElement('option');
        option.value = uid;
        option.textContent = uid;
        echoPageUidSelector.appendChild(option);
    });

    // 嘗試恢復選擇，如果當前選擇仍在列表中
    if (uids.includes(current)) {
        echoPageUidSelector.value = current;
    } else if (current === "") {
        echoPageUidSelector.value = "";
    } else if (uids.length > 0) {
        // 如果之前的選擇不見了，但有其他 UID，是否預設選第一個？
        // 暫時不預設，保持 "未選擇"
    }

    // 更新匯入按鈕顯示狀態
    const hasUid = !!echoPageUidSelector.value;
    document.getElementById('echoPageImportBtn').style.display = hasUid ? 'inline-block' : 'none';
    document.getElementById('echoPageExportDataBtn').style.display = hasUid ? 'inline-block' : 'none';
    document.getElementById('echoPageImportDataBtn').style.display = hasUid ? 'inline-block' : 'none';
}

// 監聽 UID 選擇變更
echoPageUidSelector.addEventListener('change', () => {
    renderEchoList();
    updateSetFilterButtons();

    // 更新匯入按鈕顯示狀態
    const hasUid = !!echoPageUidSelector.value;
    document.getElementById('echoPageImportBtn').style.display = hasUid ? 'inline-block' : 'none';
    document.getElementById('echoPageExportDataBtn').style.display = hasUid ? 'inline-block' : 'none';
    document.getElementById('echoPageImportDataBtn').style.display = hasUid ? 'inline-block' : 'none';
});

// 新增 UID
echoPageAddUidBtn.addEventListener('click', () => {
    const newUid = prompt('請輸入新的 UID:');
    if (newUid && newUid.trim()) {
        const uid = newUid.trim();
        const uids = getUidList();
        if (!uids.includes(uid)) {
            uids.push(uid);
            uids.sort();
            saveUidList(uids);
            updateEchoPageUidSelector();
            echoPageUidSelector.value = uid; // 自動選中
            renderEchoList(); // 重新渲染列表 (應該是空的)
            updateSetFilterButtons();
            alert(`已新增 UID: ${uid}`);
        } else {
            alert('此 UID 已存在');
        }
    }
});

// 刪除 UID
echoPageDeleteUidBtn.addEventListener('click', () => {
    const uid = echoPageUidSelector.value;
    if (!uid) {
        alert('請先選擇要刪除的 UID');
        return;
    }

    if (confirm(`確定要刪除 UID: ${uid} 及其所有聲骸資料嗎？此操作無法復原。`)) {
        // 1. 從列表中移除
        const uids = getUidList();
        const index = uids.indexOf(uid);
        if (index > -1) {
            uids.splice(index, 1);
            saveUidList(uids);
        }

        // 2. 刪除該 UID 的聲骸資料
        localStorage.removeItem(`echoData_${uid}`);

        updateEchoPageUidSelector();
        // 重置選擇
        echoPageUidSelector.value = "";
        renderEchoList();
        updateSetFilterButtons();
        alert(`已刪除 UID: ${uid}`);
    }
});

// 聲骸匯出
const echoPageExportDataBtn = document.getElementById('echoPageExportDataBtn');
echoPageExportDataBtn.addEventListener('click', () => {
    const uid = echoPageUidSelector.value;
    if (!uid) return;

    const data = getEchoDataByUid(uid);
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `echo_data_${uid}_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

// 聲骸匯入
const echoPageImportDataBtn = document.getElementById('echoPageImportDataBtn');
const echoPageImportDataInput = document.getElementById('echoPageImportDataInput');

echoPageImportDataBtn.addEventListener('click', () => {
    echoPageImportDataInput.click();
});

echoPageImportDataInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const uid = echoPageUidSelector.value;
    if (!uid) {
        alert('請先選擇 UID');
        return;
    }

    if (!confirm(`確定要匯入資料到 UID: ${uid} 嗎？這將會覆蓋目前的資料。`)) {
        e.target.value = ''; // 重置 input
        return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const data = JSON.parse(event.target.result);
            if (Array.isArray(data)) {
                saveEchoDataByUid(uid, data);
                renderEchoList();
                updateSetFilterButtons();
                alert('匯入成功！');
            } else {
                alert('匯入失敗：檔案格式錯誤 (應為陣列)');
            }
        } catch (err) {
            alert('匯入失敗：無法解析 JSON');
            console.error(err);
        }
        e.target.value = ''; // 重置 input
    };
    reader.readAsText(file);
});

// ==================================================================================
// 截圖匯入功能
// ==================================================================================

const echoPageImportBtn = document.getElementById('echoPageImportBtn');
const echoPageImportInput = document.getElementById('echoPageImportInput');

// New Modal Elements
const importInstructionModal = document.getElementById('importInstructionModal');
const closeImportInstructionModalBtn = document.getElementById('closeImportInstructionModalBtn');
const confirmImportBtn = document.getElementById('confirmImportBtn');

echoPageImportBtn.addEventListener('click', () => {
    importInstructionModal.classList.add('show');
});

closeImportInstructionModalBtn.addEventListener('click', () => {
    importInstructionModal.classList.remove('show');
});

confirmImportBtn.addEventListener('click', () => {
    importInstructionModal.classList.remove('show');
    echoPageImportInput.click();
});

importInstructionModal.addEventListener('click', (event) => {
    if (event.target === importInstructionModal) {
        importInstructionModal.classList.remove('show');
    }
});

echoPageImportInput.addEventListener('change', async () => {
    if (echoPageImportInput.files.length > 0) {
        await processImportImages(echoPageImportInput.files);
        echoPageImportInput.value = ''; // Reset
    }
});

async function processImportImages(files) {
    const uid = echoPageUidSelector.value;
    if (!uid) return;

    const allResults = [];

    const originalText = echoPageImportBtn.textContent;
    echoPageImportBtn.textContent = '處理中...';
    echoPageImportBtn.disabled = true;

    for (let i = 0; i < files.length; i++) {
        try {
            // 改為直接呼叫背包辨識函式 (from ocr-backpack-script.js)
            const result = await processImageFile(files[i]);

            // 驗證資料完整性
            let isValid = true;
            // 必須要有套裝、Cost、主詞條名稱與數值
            if (!result || !result.Attributes || !result.Cost || !result.AllEchoAffix || !result.AllEchoAffix[0] || !result.AllEchoAffix[0].Name || !result.AllEchoAffix[0].Number) {
                isValid = false;
            } else {
                // 副詞條驗證：允許空詞條，但若有名稱則必須有數值，反之亦然。
                for (let j = 1; j < result.AllEchoAffix.length; j++) {
                    const affix = result.AllEchoAffix[j];
                    if ((affix.Name && !affix.Number) || (!affix.Name && affix.Number)) {
                        isValid = false;
                        break;
                    }

                }
            }

            if (isValid) {
                result.Id = Date.now() + i; // 賦予一個簡單的 ID
                allResults.push(result);
            } else {
                console.warn(`File ${files[i].name} skipped due to incomplete data (low similarity).`);
            }
        } catch (error) {
            console.error(`Error processing file ${files[i].name}:`, error);
        }
    }

    if (allResults.length > 0) {
        autoSaveEchoesToCurrentUid(allResults);
        alert(`已成功匯入 ${allResults.length} 個聲骸資料至 UID: ${uid}`);
    } else {
        alert('沒有成功辨識任何圖片');
    }

    echoPageImportBtn.textContent = originalText;
    echoPageImportBtn.disabled = false;
    return allResults;
}

function processSingleImageImport(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function (e) {
            const img = new Image();
            img.onload = async function () {
                try {
                    // 呼叫整合的辨識函式
                    const echoData = await processImportAttributes(img);

                    // 賦予新的 ID
                    echoData.Id = Date.now();

                    resolve(echoData);
                } catch (err) {
                    reject(err);
                }
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// 比較用的標準化函式：將 ID 和 Points 設為 0
function normalizeForComparison(echo) {
    // 深拷貝
    const copy = JSON.parse(JSON.stringify(echo));

    // 清除 ID 和 Points
    copy.Id = 0;
    copy.Points = 0;
    delete copy.DebugImages;
    if (copy.AllEchoAffix) {
        copy.AllEchoAffix.forEach(affix => {
            affix.Points = 0;
        });
    }

    return JSON.stringify(copy);
}

// 自動儲存聲骸至當前 UID
function autoSaveEchoesToCurrentUid(echoList) {
    const uid = echoPageUidSelector.value;

    if (!uid) return;

    if (!echoList || echoList.length === 0) return;

    const existingData = getEchoDataByUid(uid);
    let addedCount = 0;

    echoList.forEach(newEcho => {
        const newEchoNormalized = normalizeForComparison(newEcho);
        const exists = existingData.some(existEcho => {
            return normalizeForComparison(existEcho) === newEchoNormalized;
        });

        if (!exists) {
            // 儲存前將評分歸零
            const echoToSave = JSON.parse(JSON.stringify(newEcho));
            echoToSave.Points = 0;
            if (echoToSave.AllEchoAffix) {
                echoToSave.AllEchoAffix.forEach(a => a.Points = 0);
            }
            existingData.push(echoToSave);
            addedCount++;
        }
    });

    if (addedCount > 0) {
        saveEchoDataByUid(uid, existingData);
        //console.log(`自動儲存 ${addedCount} 個新聲骸至 UID: ${uid}`);
        // 如果當前在聲骸頁面，重新渲染列表
        if (echoPageSection.style.display === 'block') {
            renderEchoList();
            updateSetFilterButtons();
        }
    }
}

// ==================================================================================
// 篩選邏輯
// ==================================================================================

// 初始化 Cost 篩選按鈕
document.querySelectorAll('#filterCostGroup .filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        // 移除其他按鈕的 active
        document.querySelectorAll('#filterCostGroup .filter-btn').forEach(b => b.classList.remove('active'));
        // 啟用當前按鈕
        btn.classList.add('active');
        currentCostFilter = btn.dataset.value;
        renderEchoList();
    });
});

// 更新套裝篩選按鈕 (根據當前 UID 的資料動態生成)
function updateSetFilterButtons() {
    const uid = echoPageUidSelector.value;
    const container = document.getElementById('filterSetGroup');

    // 保留 "全部" 按鈕
    container.innerHTML = '<button class="filter-btn active" data-type="set" data-value="all">全部</button>';
    currentSetFilter = 'all'; // 重置篩選

    // 重新綁定 "全部" 按鈕事件
    container.querySelector('.filter-btn').addEventListener('click', function () {
        handleSetFilterClick(this, 'all');
    });

    if (!uid) return;

    const echoData = getEchoDataByUid(uid);
    const sets = new Set();
    echoData.forEach(echo => {
        if (echo.Attributes) {
            sets.add(echo.Attributes);
        }
    });

    // 排序並生成按鈕
    Array.from(sets).sort().forEach(setName => {
        const btn = document.createElement('button');
        btn.className = 'filter-btn';
        btn.dataset.type = 'set';
        btn.dataset.value = setName;

        const attrPic = attributesProfilePicture[setName];
        if (attrPic) {
            btn.innerHTML = `<img src="${attrPic}" style="width: 20px; height: 20px; object-fit: contain; vertical-align: middle; margin-right: 5px;">${setName}`;
        } else {
            btn.textContent = setName;
        }

        btn.addEventListener('click', function () {
            handleSetFilterClick(this, setName);
        });
        container.appendChild(btn);
    });
}

function handleSetFilterClick(btn, value) {
    // 移除其他按鈕的 active
    document.querySelectorAll('#filterSetGroup .filter-btn').forEach(b => b.classList.remove('active'));
    // 啟用當前按鈕
    btn.classList.add('active');
    currentSetFilter = value;
    renderEchoList();
}

// 渲染聲骸列表
function renderEchoList() {
    const uid = echoPageUidSelector.value;
    const container = document.getElementById('echoListContainer');
    container.innerHTML = ''; // 清空容器

    if (!uid) {
        container.innerHTML = '<div style="text-align:center; padding: 20px;">請選擇 UID 以檢視聲骸資料</div>';
        return;
    }

    let echoData = getEchoDataByUid(uid);

    if (echoData.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding: 20px;">此 UID 尚無聲骸資料</div>';
        return;
    }

    // 應用篩選
    if (currentCostFilter !== 'all') {
        echoData = echoData.filter(echo => String(echo.Cost) === currentCostFilter);
    }
    if (currentSetFilter !== 'all') {
        echoData = echoData.filter(echo => echo.Attributes === currentSetFilter);
    }

    if (echoData.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding: 20px;">沒有符合篩選條件的聲骸</div>';
        return;
    }

    // 使用 Grid 佈局顯示卡片
    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(280px, 1fr))';
    grid.style.gap = '15px';
    grid.style.padding = '10px';

    echoData.forEach((echo, index) => {
        const card = document.createElement('div');
        card.style.background = 'var(--bg-secondary)';
        card.style.border = '1px solid var(--border-color)';
        card.style.borderRadius = '10px';
        card.style.padding = '15px';
        card.style.position = 'relative';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.gap = '10px';

        // 標題區：Cost + 套裝 + 刪除按鈕
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.borderBottom = '1px solid var(--border-color)';
        header.style.paddingBottom = '8px';

        // 左側資訊 (Cost + Attributes)
        const leftInfo = document.createElement('div');
        leftInfo.style.display = 'flex';
        leftInfo.style.alignItems = 'center';
        leftInfo.style.gap = '10px';

        const costSpan = document.createElement('span');
        costSpan.className = `cost-num cost-${echo.Cost}`;
        costSpan.textContent = echo.Cost;

        const setSpan = document.createElement('span');
        setSpan.style.color = 'var(--accent-blue)';
        setSpan.style.fontWeight = 'bold';
        const attrName = echo.Attributes || '未知套裝';
        const attrPic = attributesProfilePicture[attrName];
        if (attrPic) {
            setSpan.innerHTML = `<img src="${attrPic}" title="${attrName}" style="width: 24px; height: 24px; object-fit: contain; vertical-align: middle; margin-right: 5px;">${attrName}`;
        } else {
            setSpan.textContent = attrName;
        }

        leftInfo.appendChild(costSpan);
        leftInfo.appendChild(setSpan);

        // 右側按鈕群組 (修正 + 刪除)
        const btnGroup = document.createElement('div');
        btnGroup.style.display = 'flex';
        btnGroup.style.gap = '5px';

        // 修正按鈕
        const editBtn = document.createElement('button');
        editBtn.textContent = '✎';
        editBtn.title = '修正';
        editBtn.style.background = 'transparent';
        editBtn.style.border = 'none';
        editBtn.style.color = 'var(--text-secondary)';
        editBtn.style.fontSize = '1.2rem';
        editBtn.style.cursor = 'pointer';
        editBtn.style.padding = '0 5px';
        editBtn.onclick = () => openEditModal(uid, index);
        editBtn.onmouseover = () => editBtn.style.color = 'var(--accent-blue)';
        editBtn.onmouseout = () => editBtn.style.color = 'var(--text-secondary)';

        // 刪除按鈕 (放大)
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '×';
        deleteBtn.title = '刪除';
        deleteBtn.style.background = 'transparent';
        deleteBtn.style.border = 'none';
        deleteBtn.style.color = 'var(--text-secondary)';
        deleteBtn.style.fontSize = '1.8rem'; // 放大
        deleteBtn.style.fontWeight = 'bold';
        deleteBtn.style.cursor = 'pointer';
        deleteBtn.style.lineHeight = '1';
        deleteBtn.style.padding = '0 5px';
        deleteBtn.onclick = () => deleteEchoItemByObject(uid, echo);

        // Hover 效果
        deleteBtn.onmouseover = () => deleteBtn.style.color = 'var(--accent-red)';
        deleteBtn.onmouseout = () => deleteBtn.style.color = 'var(--text-secondary)';

        btnGroup.appendChild(editBtn);
        btnGroup.appendChild(deleteBtn);

        header.appendChild(leftInfo);
        header.appendChild(btnGroup);
        card.appendChild(header);

        // 詞條列表區
        const affixList = document.createElement('div');
        affixList.style.display = 'flex';
        affixList.style.flexDirection = 'column';
        affixList.style.gap = '8px';

        if (echo.AllEchoAffix && echo.AllEchoAffix.length > 0) {
            echo.AllEchoAffix.forEach(affix => {
                if (!affix.Name) return; // 跳過無效詞條

                const item = document.createElement('div');
                item.style.display = 'flex';
                // 修改為單行排序
                item.style.flexDirection = 'row';
                item.style.justifyContent = 'space-between';
                item.style.alignItems = 'center';
                item.style.background = 'rgba(255, 255, 255, 0.03)';
                item.style.padding = '5px 8px';
                item.style.borderRadius = '4px';

                const nameDiv = document.createElement('div');
                nameDiv.style.fontSize = '0.9rem';
                nameDiv.style.color = 'var(--text-secondary)';
                nameDiv.textContent = affix.Name;

                const valDiv = document.createElement('div');
                valDiv.style.fontSize = '1rem';
                valDiv.style.fontWeight = 'bold';
                valDiv.style.color = 'var(--text-primary)';
                valDiv.textContent = affix.Number;

                item.appendChild(nameDiv);
                item.appendChild(valDiv);
                affixList.appendChild(item);
            });
        } else {
            affixList.textContent = '無詞條資料';
            affixList.style.color = 'var(--text-secondary)';
            affixList.style.textAlign = 'center';
        }

        card.appendChild(affixList);
        grid.appendChild(card);
    });

    container.appendChild(grid);
}

// 刪除單個聲骸 (透過物件比對)
window.deleteEchoItemByObject = function (uid, echoToDelete) {
    if (!confirm('確定要刪除此聲骸嗎？')) return;

    const echoData = getEchoDataByUid(uid);
    const targetStr = normalizeForComparison(echoToDelete);

    const index = echoData.findIndex(e => normalizeForComparison(e) === targetStr);

    if (index !== -1) {
        echoData.splice(index, 1);
        saveEchoDataByUid(uid, echoData);
        renderEchoList();
        updateSetFilterButtons();
    }
};

// 修改 checkCanExport 以觸發自動儲存
// 我們需要攔截原始的 checkCanExport 或者在其中插入邏輯
// 由於無法直接修改函式內部 (除非 replace_string)，我們可以在 checkCanExport 之後執行
// 但 checkCanExport 是被 processImage 呼叫的。
// 我們可以覆寫 checkCanExport，但要小心保留原功能。

const originalCheckCanExport = checkCanExport;
checkCanExport = function () {
    // 執行原始邏輯
    originalCheckCanExport();

    // 執行自動儲存邏輯
    try {
        const val = jsonOutput.value;
        if (val && val.startsWith('{')) {
            const data = JSON.parse(val);

            // 1. 嘗試從辨識結果中獲取 UID
            const detectedUid = data.UID;

            if (detectedUid) {
                // 如果辨識出 UID，自動新增至列表 (如果不存在)
                const uids = getUidList();
                if (!uids.includes(detectedUid)) {
                    uids.push(detectedUid);
                    uids.sort();
                    saveUidList(uids);
                    updateEchoPageUidSelector();
                }

                // 自動切換到該 UID (可選，根據需求 "加入UID及聲骸自動處理")
                // 如果我們希望 "自動處理"，那應該將資料存入 detectedUid

                // 儲存資料到 detectedUid
                if (data.list && data.list.length > 0) {
                    const existingData = getEchoDataByUid(detectedUid);
                    let addedCount = 0;

                    data.list.forEach(newEcho => {
                        const newEchoNormalized = normalizeForComparison(newEcho);
                        const exists = existingData.some(existEcho => {
                            return normalizeForComparison(existEcho) === newEchoNormalized;
                        });

                        if (!exists) {
                            // 儲存前將評分歸零
                            const echoToSave = JSON.parse(JSON.stringify(newEcho));
                            echoToSave.Points = 0;
                            if (echoToSave.AllEchoAffix) {
                                echoToSave.AllEchoAffix.forEach(a => a.Points = 0);
                            }
                            existingData.push(echoToSave);
                            addedCount++;
                        }
                    });

                    if (addedCount > 0) {
                        saveEchoDataByUid(detectedUid, existingData);
                        console.log(`[自動處理] 已儲存 ${addedCount} 個聲骸至 UID: ${detectedUid}`);

                        // 如果當前顯示的是該 UID，重新渲染
                        if (echoPageUidSelector.value === detectedUid && echoPageSection.style.display === 'block') {
                            renderEchoList();
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.error("自動儲存失敗", e);
    }
};

// ==================== 更換聲骸功能 ====================
let currentReplaceIndex = -1;

// 綁定關閉按鈕事件
const closeReplaceBtn = document.getElementById('closeReplaceModalBtn');
if (closeReplaceBtn) {
    closeReplaceBtn.addEventListener('click', closeReplaceModal);
}

window.addEventListener('click', (event) => {
    const modal = document.getElementById('replaceModal');
    if (event.target == modal) {
        closeReplaceModal();
    }
});

function openReplaceModal(index) {
    currentReplaceIndex = index;
    const modal = document.getElementById('replaceModal');
    const listContainer = document.getElementById('candidateEchoList');
    const currentContainer = document.getElementById('currentEchoContainer');

    if (!window.currentJsonResult || !window.currentJsonResult.list) {
        alert('無法取得當前聲骸資料。');
        return;
    }

    const currentEcho = window.currentJsonResult.list[index];
    const uid = window.currentJsonResult.UID;

    if (!uid) {
        alert('未偵測到 UID，無法載入儲存的聲骸。');
        return;
    }

    // 顯示 Modal
    modal.classList.add('show');
    listContainer.innerHTML = '<div style="text-align: center; padding: 20px;">載入中...</div>';

    // 渲染當前聲骸
    if (currentContainer) {
        const item = currentEcho;
        const itemScore = parseFloat(item.Points) || 0;
        let itemScoreColor = itemScore >= 8 ? 'score-high' : (itemScore < 5 ? 'score-low' : 'score-medium');
        const costVal = item.Cost || 1;
        let shortName = item.Attributes || '聲骸';
        const attrPic = attributesProfilePicture[shortName];
        let attrDisplay = attrPic
            ? `<img src="${attrPic}" title="${shortName}" style="width: 24px; height: 24px; object-fit: contain; vertical-align: middle;">`
            : shortName;

        const filteredAffixes = (item.AllEchoAffix || []).filter(affix => affix.Id !== 0);
        let affixRows = filteredAffixes.map(affix => {
            const pts = parseFloat(affix.Points) || 0;
            const ptClass = pts > 0 ? 'point-pos' : 'point-zero';
            const name = affix.Name;
            return `<tr><td class="affix-name">${name}</td><td class="affix-value">${affix.Number}</td><td class="affix-point ${ptClass}">${pts.toFixed(2)}</td></tr>`;
        }).join('');

        currentContainer.innerHTML = `
                        <div class="equipment-card" style="width: 100%; max-width: 300px; margin: 0 auto;">
                            <div class="equipment-header-row">
                                <span class="cost-num cost-${costVal}">${costVal}</span>
                                <span class="echo-name">${attrDisplay}</span>
                                <span class="echo-score ${itemScoreColor}">${itemScore.toFixed(2)}</span>
                            </div>
                            <table class="affix-table">
                                ${affixRows}
                            </table>
                        </div>
                 `;
    }

    // 取得候選聲骸
    const allEchoes = getEchoDataByUid(uid);

    // 篩選條件：相同 Cost 和 套裝 (Attributes)
    const candidates = allEchoes.filter(echo => {
        return echo.Cost == currentEcho.Cost &&
            echo.Attributes == currentEcho.Attributes;
    });

    if (candidates.length === 0) {
        listContainer.innerHTML = '<div style="text-align: center; padding: 20px;">沒有找到符合條件 (同Cost、同套裝) 的聲骸。</div>';
        return;
    }

    // 計算候選聲骸的分數 (針對當前角色)
    const resonatorName = window.currentJsonResult.Name;
    const resonatorChainLevel = window.currentJsonResult.NumberOfStars;
    let resonatorWeights = null;

    if (resonatorData[resonatorName] && resonatorData[resonatorName][resonatorChainLevel]) {
        resonatorWeights = resonatorData[resonatorName][resonatorChainLevel];
    }

    // 渲染列表
    let html = '<table style="width: 100%; border-collapse: collapse;">';
    html += '<thead><tr style="border-bottom: 1px solid var(--border-color);"><th style="padding: 8px;">主詞條</th><th style="padding: 8px;">副詞條</th><th style="padding: 8px;">評分</th><th style="padding: 8px;">操作</th></tr></thead>';
    html += '<tbody>';

    candidates.forEach((echo, idx) => {
        // 計算分數
        let score = 0;
        if (resonatorWeights) {
            score = calculateEchoTotalScore(echo.AllEchoAffix, resonatorWeights, echo.Cost);
        } else {
            score = echo.Points || 0;
        }

        // 格式化副詞條顯示
        const subAffixes = echo.AllEchoAffix.slice(1).map(a => {
            if (!a.Name || a.Name === '未辨識') return '';
            return `<div style="font-size: 0.8rem; color: var(--text-secondary);">${a.Name} ${a.Number}</div>`;
        }).join('');

        const mainAffix = echo.AllEchoAffix[0];
        const mainAffixDisplay = `${mainAffix.Name} <br><span style="font-size: 0.8rem; color: var(--accent-gold);">${mainAffix.Number}</span>`;

        let scoreColor = score >= 8 ? 'color: #4caf50;' : (score < 5 ? 'color: #f44336;' : 'color: #ff9800;');

        html += `
                    <tr style="border-bottom: 1px solid var(--border-color-light);">
                        <td style="padding: 8px; vertical-align: top;">${mainAffixDisplay}</td>
                        <td style="padding: 8px;">${subAffixes}</td>
                        <td style="padding: 8px; font-weight: bold; ${scoreColor}">${score.toFixed(2)}</td>
                        <td style="padding: 8px;">
                            <button class="switch-btn" style="padding: 4px 12px; font-size: 0.9rem;" onclick="selectReplacement(${idx})">選擇</button>
                        </td>
                    </tr>
                `;

        echo._tempScore = score;
    });

    html += '</tbody></table>';
    listContainer.innerHTML = html;

    window.currentCandidates = candidates;
}

function closeReplaceModal() {
    document.getElementById('replaceModal').classList.remove('show');
    currentReplaceIndex = -1;
    window.currentCandidates = null;
}

function selectReplacement(candidateIndex) {
    if (currentReplaceIndex === -1 || !window.currentCandidates) return;

    const selectedEcho = window.currentCandidates[candidateIndex];
    const targetIndex = currentReplaceIndex;

    const newEcho = JSON.parse(JSON.stringify(selectedEcho));

    if (selectedEcho._tempScore !== undefined) {
        newEcho.Points = selectedEcho._tempScore;
    }

    // 更新 localStorage 中的聲骸分數
    const uid = window.currentJsonResult.UID;
    if (uid) {
        const allEchoes = getEchoDataByUid(uid);
        // 嘗試透過 Id 尋找
        let echoInDbIndex = -1;
        if (selectedEcho.Id) {
            echoInDbIndex = allEchoes.findIndex(e => e.Id === selectedEcho.Id);
        }

        // 如果沒有 Id 或找不到，嘗試透過內容比對 (雖然不太可靠，但作為備案)
        if (echoInDbIndex === -1) {
            const targetStr = normalizeForComparison(selectedEcho);
            echoInDbIndex = allEchoes.findIndex(e => normalizeForComparison(e) === targetStr);
        }

        if (echoInDbIndex !== -1) {
            allEchoes[echoInDbIndex].Points = newEcho.Points;
            saveEchoDataByUid(uid, allEchoes);
        }
    }

    window.currentJsonResult.list[targetIndex] = newEcho;

    recalculateTotalScore(window.currentJsonResult);

    jsonOutput.value = JSON.stringify(window.currentJsonResult, null, 2);
    renderResult(window.currentJsonResult);

    closeReplaceModal();
}

function recalculateTotalScore(resultData) {
    const resonatorName = resultData.Name;
    const resonatorChainLevel = resultData.NumberOfStars;

    if (resonatorData[resonatorName] && resonatorData[resonatorName][resonatorChainLevel]) {
        const resonatorWeights = resonatorData[resonatorName][resonatorChainLevel];

        let totalScore = 0;
        let validAffixCount = 0;
        let totalResonanceEfficiency = 0;

        for (const echo of resultData.list) {
            echo.Points = calculateEchoTotalScore(echo.AllEchoAffix, resonatorWeights, echo.Cost);
            totalScore += echo.Points;

            for (let i = 0; i < echo.AllEchoAffix.length; i++) {
                const affix = echo.AllEchoAffix[i];
                if (affix.Name && affix.Name !== '未辨識' && affix.Name !== '' &&
                    affix.Number && affix.Number !== '未知' && affix.Number !== '-' && affix.Number !== '座標未設定') {
                    validAffixCount++;

                    if (affix.Name === '共鳴效率' && affix.Number) {
                        const numericValue = parseFloat(affix.Number.replace('%', ''));
                        if (!isNaN(numericValue)) {
                            totalResonanceEfficiency += numericValue;
                        }
                    }
                }
            }
        }

        const resonanceThreshold = resonatorWeights['共鳴效率閥值'] || 0;
        const resonanceMin = resonatorWeights['共鳴效率Min'] || 0;
        const resonanceMax = resonatorWeights['共鳴效率Max'] || 0;
        const maxScoreBase = resonatorWeights['最高分'] || 1;

        let finalScore = totalScore;

        if (totalResonanceEfficiency > resonanceThreshold) {
            const overflow = totalResonanceEfficiency - resonanceThreshold;
            const penalty = (overflow * (resonanceMin - resonanceMax) * 100) / maxScoreBase;
            finalScore = totalScore - penalty;
        }

        resultData.Total總分 = Math.round(finalScore * 100) / 100;
        resultData.ValidAffix = validAffixCount;
        resultData.Total共鳴效率 = Math.round(totalResonanceEfficiency * 100) / 100;
    }
}


// 輔助函數：解壓縮為 0/1 陣列
function decompressToBitArray(compressed, width, height) {
    const pixelCount = width * height;
    const bitArray = new Uint8Array(pixelCount);

    for (let i = 0; i < pixelCount; i++) {
        const byteIndex = Math.floor(i / 8);
        const bitIndex = 7 - (i % 8);
        const bit = (compressed[byteIndex] >> bitIndex) & 1;
        bitArray[i] = bit;
    }

    return bitArray;
}

function processImportAttributes(img) {
    return new Promise((resolve, reject) => {
        try {
            // 重置辨識結果
            let recognitionResults = {
                Id: 0,
                Cost: "1",
                Attributes: "",
                AllEchoAffix: [
                    { Name: "攻擊", Number: "", Points: 0 }, // 預設 MainAffix
                    { Name: "", Number: "", Points: 0 },
                    { Name: "", Number: "", Points: 0 },
                    { Name: "", Number: "", Points: 0 },
                    { Name: "", Number: "", Points: 0 },
                    { Name: "", Number: "", Points: 0 }
                ],
                Points: 0
            };

            // 1. 擷取圖片 & 屬性辨識
            const width = ATTRIBUTES_CONFIG.xEnd - ATTRIBUTES_CONFIG.xStart;
            const height = ATTRIBUTES_CONFIG.yEnd - ATTRIBUTES_CONFIG.yStart;
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = width;
            cropCanvas.height = height;
            const cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true });
            cropCtx.drawImage(img, ATTRIBUTES_CONFIG.xStart, ATTRIBUTES_CONFIG.yStart, width, height, 0, 0, width, height);

            const imageData = cropCtx.getImageData(0, 0, width, height);
            const data = imageData.data;
            const currentBinaryArray = new Uint8Array(width * height);

            for (let i = 0; i < data.length; i += 4) {
                const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
                const val = gray > ATTRIBUTES_CONFIG.threshold ? 255 : 0;
                currentBinaryArray[i / 4] = val === 255 ? 1 : 0;
            }

            compareAttributes(currentBinaryArray, width, height, recognitionResults);

            // 4. 處理成本辨識
            processCost(img, recognitionResults);

            // 5. 處理 MainAffix 辨識
            processMainAffix(img, recognitionResults);

            // 6-15. 處理 SupAffix 辨識
            processSupAffixNumber(img, recognitionResults);
            processSupAffixNumber2(img, recognitionResults);
            processSupAffixNumber3(img, recognitionResults);
            processSupAffixNumber4(img, recognitionResults);
            processSupAffixNumber5(img, recognitionResults);

            processSupAffix1(img, recognitionResults);
            processSupAffix2(img, recognitionResults);
            processSupAffix3(img, recognitionResults);
            processSupAffix4(img, recognitionResults);
            processSupAffix5(img, recognitionResults);

            resolve(recognitionResults);
        } catch (err) {
            reject(err);
        }
    });
}

// 清除舊版殘留的 DebugImages 資料以釋放 LocalStorage 空間
function cleanupLegacyDebugImages() {
    if (localStorage.getItem('debugImagesCleaned_v1')) return;

    const cleanList = (list) => {
        if (!list || !Array.isArray(list)) return false;
        let changed = false;
        list.forEach(echo => {
            if (echo.DebugImages) {
                delete echo.DebugImages;
                changed = true;
            }
        });
        return changed;
    };

    try {
        const historyRaw = localStorage.getItem('recognitionHistory');
        if (historyRaw) {
            const history = JSON.parse(historyRaw);
            history.forEach(item => { if (item.data) cleanList(item.data.list); });
            localStorage.setItem('recognitionHistory', JSON.stringify(history));
        }
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('echoData_')) {
                const data = JSON.parse(localStorage.getItem(key));
                if (cleanList(data)) localStorage.setItem(key, JSON.stringify(data));
            }
        }
        const lastJsonRaw = localStorage.getItem('lastJsonData');
        if (lastJsonRaw) {
            const data = JSON.parse(lastJsonRaw);
            if (cleanList(data.list)) localStorage.setItem('lastJsonData', JSON.stringify(data));
        }
        localStorage.setItem('debugImagesCleaned_v1', 'true');
    } catch (e) { console.error('Cleanup error:', e); }
}
cleanupLegacyDebugImages();

function compareAttributes(currentBinaryArray, width, height, resultsObj) {
    const keys = Object.keys(AttributesData);
    if (keys.length === 0) return;

    const results = keys.map(name => {
        const attr = AttributesData[name];
        const compressedData = new Uint8Array(atob(attr.data).split('').map(c => c.charCodeAt(0)));
        const attrBinaryArray = decompressToBitArray(compressedData, attr.width, attr.height);

        let matchCount = 0;
        const totalPixels = width * height;

        if (attr.width !== width || attr.height !== height) {
            return { name: name, similarity: 0 };
        }

        for (let i = 0; i < totalPixels; i++) {
            if (currentBinaryArray[i] === attrBinaryArray[i]) {
                matchCount++;
            }
        }

        const similarity = (matchCount / totalPixels) * 100;
        return { name: name, similarity: similarity };
    });

    results.sort((a, b) => b.similarity - a.similarity);
    const topResult = results[0];
    if (topResult.similarity < 80) {
        resultsObj.Attributes = "";
    } else {
        resultsObj.Attributes = topResult.name;
    }
}

function processCost(img, resultsObj) {
    const costWidth = COST_CONFIG.xEnd - COST_CONFIG.xStart;
    const costHeight = COST_CONFIG.yEnd - COST_CONFIG.yStart;
    const canvas = document.createElement('canvas');
    canvas.width = costWidth;
    canvas.height = costHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, COST_CONFIG.xStart, COST_CONFIG.yStart, costWidth, costHeight, 0, 0, costWidth, costHeight);

    const imageData = ctx.getImageData(0, 0, costWidth, costHeight);
    const data = imageData.data;
    const currentBinaryArray = new Uint8Array(costWidth * costHeight);

    for (let i = 0; i < data.length; i += 4) {
        const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const val = gray > COST_CONFIG.threshold ? 255 : 0;
        currentBinaryArray[i / 4] = val === 255 ? 1 : 0;
    }

    compareCost(currentBinaryArray, costWidth, costHeight, resultsObj);
}

function compareCost(currentBinaryArray, width, height, resultsObj) {
    const keys = Object.keys(CostData);
    if (keys.length === 0) return;

    const results = keys.map(name => {
        const cost = CostData[name];
        const compressedData = new Uint8Array(atob(cost.data).split('').map(c => c.charCodeAt(0)));
        const costBinaryArray = decompressToBitArray(compressedData, cost.width, cost.height);

        let matchCount = 0;
        const totalPixels = width * height;

        if (cost.width !== width || cost.height !== height) {
            return { name: name, similarity: 0 };
        }

        for (let i = 0; i < totalPixels; i++) {
            if (currentBinaryArray[i] === costBinaryArray[i]) {
                matchCount++;
            }
        }

        const similarity = (matchCount / totalPixels) * 100;
        return { name: name, similarity: similarity };
    });

    results.sort((a, b) => b.similarity - a.similarity);
    const topResult = results[0];
    if (topResult.similarity < 80) {
        resultsObj.Cost = "";
    } else {
        resultsObj.Cost = topResult.name;
    }
}

function processMainAffix(img, resultsObj) {
    const width = MAIN_AFFIX_CONFIG.xEnd - MAIN_AFFIX_CONFIG.xStart;
    const height = MAIN_AFFIX_CONFIG.yEnd - MAIN_AFFIX_CONFIG.yStart;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, MAIN_AFFIX_CONFIG.xStart, MAIN_AFFIX_CONFIG.yStart, width, height, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const currentBinaryArray = new Uint8Array(width * height);

    for (let i = 0; i < data.length; i += 4) {
        const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const val = gray > MAIN_AFFIX_CONFIG.threshold ? 255 : 0;
        currentBinaryArray[i / 4] = val === 255 ? 1 : 0;
    }

    compareMainAffix(currentBinaryArray, width, height, resultsObj);
}

function compareMainAffix(currentBinaryArray, width, height, resultsObj) {
    const keys = Object.keys(MainAffixData);
    if (keys.length === 0) return;

    const results = keys.map(name => {
        const data = MainAffixData[name];
        const compressedData = new Uint8Array(atob(data.data).split('').map(c => c.charCodeAt(0)));
        const binaryArray = decompressToBitArray(compressedData, data.width, data.height);

        let matchCount = 0;
        const totalPixels = width * height;

        if (data.width !== width || data.height !== height) {
            return { name: name, similarity: 0 };
        }

        for (let i = 0; i < totalPixels; i++) {
            if (currentBinaryArray[i] === binaryArray[i]) {
                matchCount++;
            }
        }

        const similarity = (matchCount / totalPixels) * 100;
        return { name: name, similarity: similarity };
    });

    results.sort((a, b) => b.similarity - a.similarity);
    const topResult = results[0];

    if (topResult.similarity < 80) {
        resultsObj.AllEchoAffix[0].Name = "";
        resultsObj.AllEchoAffix[0].Number = "";
    } else {
        resultsObj.AllEchoAffix[0].Name = topResult.name;
        const cost = resultsObj.Cost;
        if (mainAffixFixedValues[cost] && mainAffixFixedValues[cost][topResult.name]) {
            resultsObj.AllEchoAffix[0].Number = mainAffixFixedValues[cost][topResult.name];
        }
    }
}

function processSupAffixNumber(img, resultsObj) {
    const width = SUP_AFFIX_NUMBER_CONFIG.xEnd - SUP_AFFIX_NUMBER_CONFIG.xStart;
    const height = SUP_AFFIX_NUMBER_CONFIG.yEnd - SUP_AFFIX_NUMBER_CONFIG.yStart;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, SUP_AFFIX_NUMBER_CONFIG.xStart, SUP_AFFIX_NUMBER_CONFIG.yStart, width, height, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const currentBinaryArray = new Uint8Array(width * height);

    for (let i = 0; i < data.length; i += 4) {
        const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const val = gray > SUP_AFFIX_NUMBER_CONFIG.threshold ? 255 : 0;
        currentBinaryArray[i / 4] = val === 255 ? 1 : 0;
    }

    compareSupAffixNumber(currentBinaryArray, width, height, resultsObj, 1);
}

function processSupAffixNumber2(img, resultsObj) {
    const width = SUP_AFFIX_NUMBER_2_CONFIG.xEnd - SUP_AFFIX_NUMBER_2_CONFIG.xStart;
    const height = SUP_AFFIX_NUMBER_2_CONFIG.yEnd - SUP_AFFIX_NUMBER_2_CONFIG.yStart;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, SUP_AFFIX_NUMBER_2_CONFIG.xStart, SUP_AFFIX_NUMBER_2_CONFIG.yStart, width, height, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const currentBinaryArray = new Uint8Array(width * height);

    for (let i = 0; i < data.length; i += 4) {
        const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const val = gray > SUP_AFFIX_NUMBER_2_CONFIG.threshold ? 255 : 0;
        currentBinaryArray[i / 4] = val === 255 ? 1 : 0;
    }

    compareSupAffixNumber(currentBinaryArray, width, height, resultsObj, 2);
}

function processSupAffixNumber3(img, resultsObj) {
    const width = SUP_AFFIX_NUMBER_3_CONFIG.xEnd - SUP_AFFIX_NUMBER_3_CONFIG.xStart;
    const height = SUP_AFFIX_NUMBER_3_CONFIG.yEnd - SUP_AFFIX_NUMBER_3_CONFIG.yStart;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, SUP_AFFIX_NUMBER_3_CONFIG.xStart, SUP_AFFIX_NUMBER_3_CONFIG.yStart, width, height, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const currentBinaryArray = new Uint8Array(width * height);

    for (let i = 0; i < data.length; i += 4) {
        const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const val = gray > SUP_AFFIX_NUMBER_3_CONFIG.threshold ? 255 : 0;
        currentBinaryArray[i / 4] = val === 255 ? 1 : 0;
    }

    compareSupAffixNumber(currentBinaryArray, width, height, resultsObj, 3);
}

function processSupAffixNumber4(img, resultsObj) {
    const width = SUP_AFFIX_NUMBER_4_CONFIG.xEnd - SUP_AFFIX_NUMBER_4_CONFIG.xStart;
    const height = SUP_AFFIX_NUMBER_4_CONFIG.yEnd - SUP_AFFIX_NUMBER_4_CONFIG.yStart;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, SUP_AFFIX_NUMBER_4_CONFIG.xStart, SUP_AFFIX_NUMBER_4_CONFIG.yStart, width, height, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const currentBinaryArray = new Uint8Array(width * height);

    for (let i = 0; i < data.length; i += 4) {
        const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const val = gray > SUP_AFFIX_NUMBER_4_CONFIG.threshold ? 255 : 0;
        currentBinaryArray[i / 4] = val === 255 ? 1 : 0;
    }

    compareSupAffixNumber(currentBinaryArray, width, height, resultsObj, 4);
}

function processSupAffixNumber5(img, resultsObj) {
    const width = SUP_AFFIX_NUMBER_5_CONFIG.xEnd - SUP_AFFIX_NUMBER_5_CONFIG.xStart;
    const height = SUP_AFFIX_NUMBER_5_CONFIG.yEnd - SUP_AFFIX_NUMBER_5_CONFIG.yStart;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, SUP_AFFIX_NUMBER_5_CONFIG.xStart, SUP_AFFIX_NUMBER_5_CONFIG.yStart, width, height, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const currentBinaryArray = new Uint8Array(width * height);

    for (let i = 0; i < data.length; i += 4) {
        const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const val = gray > SUP_AFFIX_NUMBER_5_CONFIG.threshold ? 255 : 0;
        currentBinaryArray[i / 4] = val === 255 ? 1 : 0;
    }

    compareSupAffixNumber(currentBinaryArray, width, height, resultsObj, 5);
}

function compareSupAffixNumber(currentBinaryArray, width, height, resultsObj, index) {
    const keys = Object.keys(SupAffixNumberData);
    if (keys.length === 0) return;

    const results = keys.map(name => {
        const data = SupAffixNumberData[name];
        const compressedData = new Uint8Array(atob(data.data).split('').map(c => c.charCodeAt(0)));
        const binaryArray = decompressToBitArray(compressedData, data.width, data.height);

        let matchCount = 0;
        const totalPixels = width * height;

        if (data.width !== width || data.height !== height) {
            return { name: name, similarity: 0 };
        }

        for (let i = 0; i < totalPixels; i++) {
            if (currentBinaryArray[i] === binaryArray[i]) {
                matchCount++;
            }
        }

        const similarity = (matchCount / totalPixels) * 100;
        return { name: name, similarity: similarity };
    });

    results.sort((a, b) => b.similarity - a.similarity);
    const topResult = results[0];
    if (topResult.similarity < 80) {
        resultsObj.AllEchoAffix[index].Number = "";
    } else {
        resultsObj.AllEchoAffix[index].Number = topResult.name;
    }
}

function processSupAffix1(img, resultsObj) {
    const width = SUP_AFFIX_1_CONFIG.xEnd - SUP_AFFIX_1_CONFIG.xStart;
    const height = SUP_AFFIX_1_CONFIG.yEnd - SUP_AFFIX_1_CONFIG.yStart;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, SUP_AFFIX_1_CONFIG.xStart, SUP_AFFIX_1_CONFIG.yStart, width, height, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const currentBinaryArray = new Uint8Array(width * height);

    for (let i = 0; i < data.length; i += 4) {
        const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const val = gray > SUP_AFFIX_1_CONFIG.threshold ? 255 : 0;
        currentBinaryArray[i / 4] = val === 255 ? 1 : 0;
    }

    compareSupAffix(currentBinaryArray, width, height, resultsObj, 1);
}

function processSupAffix2(img, resultsObj) {
    const width = SUP_AFFIX_2_CONFIG.xEnd - SUP_AFFIX_2_CONFIG.xStart;
    const height = SUP_AFFIX_2_CONFIG.yEnd - SUP_AFFIX_2_CONFIG.yStart;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, SUP_AFFIX_2_CONFIG.xStart, SUP_AFFIX_2_CONFIG.yStart, width, height, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const currentBinaryArray = new Uint8Array(width * height);

    for (let i = 0; i < data.length; i += 4) {
        const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const val = gray > SUP_AFFIX_2_CONFIG.threshold ? 255 : 0;
        currentBinaryArray[i / 4] = val === 255 ? 1 : 0;
    }

    compareSupAffix(currentBinaryArray, width, height, resultsObj, 2);
}

function processSupAffix3(img, resultsObj) {
    const width = SUP_AFFIX_3_CONFIG.xEnd - SUP_AFFIX_3_CONFIG.xStart;
    const height = SUP_AFFIX_3_CONFIG.yEnd - SUP_AFFIX_3_CONFIG.yStart;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, SUP_AFFIX_3_CONFIG.xStart, SUP_AFFIX_3_CONFIG.yStart, width, height, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const currentBinaryArray = new Uint8Array(width * height);

    for (let i = 0; i < data.length; i += 4) {
        const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const val = gray > SUP_AFFIX_3_CONFIG.threshold ? 255 : 0;
        currentBinaryArray[i / 4] = val === 255 ? 1 : 0;
    }

    compareSupAffix(currentBinaryArray, width, height, resultsObj, 3);
}

function processSupAffix4(img, resultsObj) {
    const width = SUP_AFFIX_4_CONFIG.xEnd - SUP_AFFIX_4_CONFIG.xStart;
    const height = SUP_AFFIX_4_CONFIG.yEnd - SUP_AFFIX_4_CONFIG.yStart;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, SUP_AFFIX_4_CONFIG.xStart, SUP_AFFIX_4_CONFIG.yStart, width, height, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const currentBinaryArray = new Uint8Array(width * height);

    for (let i = 0; i < data.length; i += 4) {
        const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const val = gray > SUP_AFFIX_4_CONFIG.threshold ? 255 : 0;
        currentBinaryArray[i / 4] = val === 255 ? 1 : 0;
    }

    compareSupAffix(currentBinaryArray, width, height, resultsObj, 4);
}

function processSupAffix5(img, resultsObj) {
    const width = SUP_AFFIX_5_CONFIG.xEnd - SUP_AFFIX_5_CONFIG.xStart;
    const height = SUP_AFFIX_5_CONFIG.yEnd - SUP_AFFIX_5_CONFIG.yStart;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, SUP_AFFIX_5_CONFIG.xStart, SUP_AFFIX_5_CONFIG.yStart, width, height, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const currentBinaryArray = new Uint8Array(width * height);

    for (let i = 0; i < data.length; i += 4) {
        const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const val = gray > SUP_AFFIX_5_CONFIG.threshold ? 255 : 0;
        currentBinaryArray[i / 4] = val === 255 ? 1 : 0;
    }

    compareSupAffix(currentBinaryArray, width, height, resultsObj, 5);
}

function compareSupAffix(currentBinaryArray, width, height, resultsObj, index) {
    const keys = Object.keys(SupAffixData);
    if (keys.length === 0) return;

    const results = keys.map(name => {
        const data = SupAffixData[name];
        const compressedData = new Uint8Array(atob(data.data).split('').map(c => c.charCodeAt(0)));
        const binaryArray = decompressToBitArray(compressedData, data.width, data.height);

        let matchCount = 0;
        const totalPixels = width * height;

        if (data.width !== width || data.height !== height) {
            return { name: name, similarity: 0 };
        }

        for (let i = 0; i < totalPixels; i++) {
            if (currentBinaryArray[i] === binaryArray[i]) {
                matchCount++;
            }
        }

        const similarity = (matchCount / totalPixels) * 100;
        return { name: name, similarity: similarity };
    });

    results.sort((a, b) => b.similarity - a.similarity);
    const topResult = results[0];
    if (topResult.similarity < 80) {
        resultsObj.AllEchoAffix[index].Name = "";
    } else {
        resultsObj.AllEchoAffix[index].Name = topResult.name;
    }
}
// ==================================================================================
// 修正聲骸功能
// ==================================================================================

let currentEditUid = null;
let currentEditIndex = -1;

const editModal = document.getElementById('editModal');
const closeEditModalBtn = document.getElementById('closeEditModalBtn');
const saveEditBtn = document.getElementById('saveEditBtn');

if (closeEditModalBtn) {
    closeEditModalBtn.addEventListener('click', () => {
        editModal.classList.remove('show');
    });
}

if (saveEditBtn) {
    saveEditBtn.addEventListener('click', saveEditModal);
}

window.addEventListener('click', (event) => {
    if (event.target === editModal) {
        editModal.classList.remove('show');
    }
});

function openEditModal(uid, index) {
    currentEditUid = uid;
    currentEditIndex = index;

    const echoData = getEchoDataByUid(uid);
    if (!echoData || !echoData[index]) {
        alert('找不到聲骸資料');
        return;
    }

    const echo = echoData[index];
    populateEditModal(echo);
    editModal.classList.add('show');
}

function populateEditModal(echo) {
    // 1. Cost
    const costSelect = document.getElementById('editCost');
    costSelect.innerHTML = '';
    ['4', '3', '1'].forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        if (String(echo.Cost) === c) opt.selected = true;
        costSelect.appendChild(opt);
    });

    // 2. Set (Attributes)
    const setSelect = document.getElementById('editSet');
    const setImg = document.getElementById('editSetImg');
    setSelect.innerHTML = '';
    const sets = Object.keys(AttributesData).sort();
    sets.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        if (echo.Attributes === s) opt.selected = true;
        setSelect.appendChild(opt);
    });

    // Update Set Image
    const updateSetImage = () => {
        const attrName = setSelect.value;
        const attrPic = attributesProfilePicture[attrName];
        if (attrPic) {
            setImg.src = attrPic;
            setImg.style.display = 'block';
        } else {
            setImg.style.display = 'none';
        }
    };
    setSelect.onchange = updateSetImage;
    updateSetImage();

    // 3. Main Affix
    const mainNameSelect = document.getElementById('editMainName');

    // Initial population of Main Affix Options based on Cost
    updateMainAffixOptions(echo.AllEchoAffix[0].Name);

    // Main Affix Value (Dropdown based on Cost and Name)
    updateMainAffixValueOptions(echo.AllEchoAffix[0].Number);

    // Event listeners
    costSelect.onchange = () => {
        updateMainAffixOptions(); // Re-filter names based on new cost
        updateMainAffixValueOptions(); // Update values
    };
    mainNameSelect.onchange = () => updateMainAffixValueOptions();

    // 4. Sub Stats
    const subStatsContainer = document.getElementById('editSubStatsContainer');
    subStatsContainer.innerHTML = '';

    for (let i = 1; i <= 5; i++) {
        const affix = echo.AllEchoAffix[i] || { Name: '', Number: '' };

        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.gap = '10px';
        row.style.marginBottom = '10px';
        row.style.alignItems = 'center';

        const label = document.createElement('label');
        label.textContent = `#${i}`;
        label.style.width = '20px';
        label.style.color = 'var(--text-secondary)';

        const nameSel = document.createElement('select');
        nameSel.id = `editSubStatName_${i}`;
        nameSel.className = 'form-control';
        nameSel.style.flex = '1';
        nameSel.style.padding = '8px';
        nameSel.style.background = 'var(--bg-secondary)';
        nameSel.style.border = '1px solid var(--border-color)';
        nameSel.style.color = 'var(--text-primary)';
        nameSel.style.borderRadius = '4px';
        nameSel.dataset.index = i;

        // Initial population (will be refined by updateAllSubStatOptions)
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = '(無)';
        nameSel.appendChild(defaultOpt);

        // Set initial value temporarily so updateAllSubStatOptions knows what to keep
        if (affix.Name) {
            const opt = document.createElement('option');
            opt.value = affix.Name;
            opt.textContent = affix.Name;
            opt.selected = true;
            nameSel.appendChild(opt);
        }

        const valSel = document.createElement('select');
        valSel.id = `editSubStatValue_${i}`;
        valSel.className = 'form-control';
        valSel.style.flex = '1';
        valSel.style.padding = '8px';
        valSel.style.background = 'var(--bg-secondary)';
        valSel.style.border = '1px solid var(--border-color)';
        valSel.style.color = 'var(--text-primary)';
        valSel.style.borderRadius = '4px';

        // Populate values based on name
        updateSubAffixValueOptions(nameSel, valSel, affix.Number);

        nameSel.addEventListener('change', () => {
            updateAllSubStatOptions();
            updateSubAffixValueOptions(nameSel, valSel);

            // Update other slots that might be affected by this name change (e.g. double stats)
            const doubleStats = ['生命', '攻擊', '防禦'];
            for (let j = 1; j <= 5; j++) {
                if (j === i) continue;
                const otherNameSel = document.getElementById(`editSubStatName_${j}`);
                if (otherNameSel && doubleStats.includes(otherNameSel.value)) {
                    const otherValSel = document.getElementById(`editSubStatValue_${j}`);
                    updateSubAffixValueOptions(otherNameSel, otherValSel, otherValSel.value);
                }
            }
        });

        // Add focus listener to ensure options are always up-to-date when user interacts
        valSel.addEventListener('focus', () => {
            updateSubAffixValueOptions(nameSel, valSel, valSel.value);
        });

        valSel.addEventListener('change', () => {
            const currentName = nameSel.value;
            const doubleStats = ['生命', '攻擊', '防禦'];
            if (doubleStats.includes(currentName)) {
                for (let j = 1; j <= 5; j++) {
                    if (j === i) continue;
                    const otherNameSel = document.getElementById(`editSubStatName_${j}`);
                    if (otherNameSel && otherNameSel.value === currentName) {
                        const otherValSel = document.getElementById(`editSubStatValue_${j}`);
                        updateSubAffixValueOptions(otherNameSel, otherValSel, otherValSel.value);
                    }
                }
            }
        });

        row.appendChild(label);
        row.appendChild(nameSel);
        row.appendChild(valSel);
        subStatsContainer.appendChild(row);
    }

    // Filter sub-stats options
    updateAllSubStatOptions();
}

function updateMainAffixOptions(currentName) {
    const cost = document.getElementById('editCost').value;
    const mainNameSelect = document.getElementById('editMainName');
    const currentSelection = currentName || mainNameSelect.value;

    mainNameSelect.innerHTML = '';

    let validNames = [];
    if (mainAffixFixedValues[cost]) {
        validNames = Object.keys(mainAffixFixedValues[cost]).sort();
    } else {
        // Fallback if cost not found (shouldn't happen)
        validNames = Object.keys(MainAffixData).sort();
    }

    validNames.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        if (m === currentSelection) opt.selected = true;
        mainNameSelect.appendChild(opt);
    });

    // If current selection is invalid for new cost, select the first valid one
    if (currentSelection && !validNames.includes(currentSelection) && validNames.length > 0) {
        mainNameSelect.value = validNames[0];
    }
}

function updateAllSubStatOptions() {
    const allSubStats = Object.keys(SupAffixData).sort();
    const selects = [];
    const counts = {};

    // 1. Collect all selects and count values
    for (let i = 1; i <= 5; i++) {
        const sel = document.getElementById(`editSubStatName_${i}`);
        if (sel) {
            selects.push(sel);
            const val = sel.value;
            if (val) {
                counts[val] = (counts[val] || 0) + 1;
            }
        }
    }

    const doubleStats = ['生命', '攻擊', '防禦'];

    // 2. Rebuild options for each select
    selects.forEach(sel => {
        const currentValue = sel.value;
        sel.innerHTML = '';

        // Default option
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = '(無)';
        sel.appendChild(defaultOpt);

        allSubStats.forEach(name => {
            // Calculate how many times this name is selected in OTHER dropdowns
            let countInOthers = counts[name] || 0;
            if (name === currentValue) {
                countInOthers--;
            }

            const maxAllowed = doubleStats.includes(name) ? 2 : 1;

            if (countInOthers < maxAllowed) {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                if (name === currentValue) opt.selected = true;
                sel.appendChild(opt);
            }
        });
    });
}

function updateMainAffixValueOptions(currentValue) {
    const cost = document.getElementById('editCost').value;
    const name = document.getElementById('editMainName').value;
    const valSelect = document.getElementById('editMainValue');
    valSelect.innerHTML = '';

    if (mainAffixFixedValues[cost] && mainAffixFixedValues[cost][name]) {
        const val = mainAffixFixedValues[cost][name];
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = val;
        opt.selected = true;
        valSelect.appendChild(opt);
        valSelect.disabled = true; // Fixed value
    } else {
        // If not found, add a default option
        const opt = document.createElement('option');
        opt.value = currentValue || '';
        opt.textContent = currentValue || '(未知)';
        valSelect.appendChild(opt);
        valSelect.disabled = false;
    }
}

function updateSubAffixValueOptions(nameSelect, valSelect, currentValue) {
    const name = nameSelect.value;
    valSelect.innerHTML = '';

    if (!name) {
        valSelect.disabled = true;
        return;
    }

    valSelect.disabled = false;
    let ranges = affixValueRanges[name];

    // Logic to filter ranges based on other slots
    const doubleStats = ['生命', '攻擊', '防禦'];
    if (doubleStats.includes(name) && ranges) {
        const currentSlotIndex = parseInt(nameSelect.dataset.index);
        let otherValueType = null; // 'percent' or 'fixed'

        for (let i = 1; i <= 5; i++) {
            if (i === currentSlotIndex) continue;

            const otherNameSel = document.getElementById(`editSubStatName_${i}`);
            const otherValSel = document.getElementById(`editSubStatValue_${i}`);

            if (otherNameSel && otherNameSel.value === name) {
                const otherVal = otherValSel.value;
                if (otherVal) {
                    if (otherVal.includes('%')) {
                        otherValueType = 'percent';
                    } else {
                        otherValueType = 'fixed';
                    }
                    break;
                }
            }
        }

        if (otherValueType === 'percent') {
            // Filter to keep only fixed values (no %)
            ranges = ranges.filter(v => !v.includes('%'));
        } else if (otherValueType === 'fixed') {
            // Filter to keep only percent values (has %)
            ranges = ranges.filter(v => v.includes('%'));
        }
    }

    if (ranges) {
        ranges.forEach(val => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = val;
            if (val === currentValue) opt.selected = true;
            valSelect.appendChild(opt);
        });

        // If current value is not in ranges (e.g. OCR error or old data), add it
        if (currentValue && !ranges.includes(currentValue)) {
            const opt = document.createElement('option');
            opt.value = currentValue;
            opt.textContent = currentValue + ' (自訂)';
            opt.selected = true;
            valSelect.appendChild(opt);
        }
    } else {
        // Fallback
        const opt = document.createElement('option');
        opt.value = currentValue || '';
        opt.textContent = currentValue || '';
        valSelect.appendChild(opt);
    }
}

function saveEditModal() {
    if (!currentEditUid || currentEditIndex === -1) return;

    const echoData = getEchoDataByUid(currentEditUid);
    if (!echoData || !echoData[currentEditIndex]) return;

    const echo = echoData[currentEditIndex];

    // Update values
    echo.Cost = document.getElementById('editCost').value;
    echo.Attributes = document.getElementById('editSet').value;

    echo.AllEchoAffix[0].Name = document.getElementById('editMainName').value;
    echo.AllEchoAffix[0].Number = document.getElementById('editMainValue').value;

    for (let i = 1; i <= 5; i++) {
        const nameSel = document.getElementById(`editSubStatName_${i}`);
        const valSel = document.getElementById(`editSubStatValue_${i}`);

        const name = nameSel.value;
        const val = valSel.value;

        if (echo.AllEchoAffix[i]) {
            echo.AllEchoAffix[i].Name = name;
            echo.AllEchoAffix[i].Number = val;
        } else {
            // Should not happen if structure is correct
            echo.AllEchoAffix.push({ Name: name, Number: val, Points: 0 });
        }
    }

    if (window.currentJsonResult && window.currentJsonResult.Name) {
        const resonatorName = window.currentJsonResult.Name;
        const resonatorChainLevel = window.currentJsonResult.NumberOfStars;
        if (resonatorData[resonatorName] && resonatorData[resonatorName][resonatorChainLevel]) {
            const weights = resonatorData[resonatorName][resonatorChainLevel];
            echo.Points = calculateEchoTotalScore(echo.AllEchoAffix, weights, echo.Cost);
        }
    }

    saveEchoDataByUid(currentEditUid, echoData);
    renderEchoList();
    const modal = document.getElementById('editModal');
    if (modal) modal.classList.remove('show');
}

// ==================================================================================
// 報名參加 (Sign Up) 邏輯
// ==================================================================================

const signUpModal = document.getElementById('signUpModal');
const signUpImageUrlInput = document.getElementById('signUpImageUrlInput');
const signUpAnalyzeBtn = document.getElementById('signUpAnalyzeBtn');
const signUpMessage = document.getElementById('signUpMessage');
const signUpResultContainer = document.getElementById('signUpResultContainer');

function openSignUpModal() {
    if (signUpModal) {
        signUpModal.classList.add('show');
        if (signUpImageUrlInput) signUpImageUrlInput.value = '';
        if (signUpAnalyzeBtn) signUpAnalyzeBtn.disabled = true;
        if (signUpMessage) signUpMessage.style.display = 'none';
        if (signUpResultContainer) signUpResultContainer.innerHTML = '<div style="color: var(--text-secondary);">請輸入網址以開始分析</div>';
    }
}

function closeSignUpModal() {
    if (signUpModal) signUpModal.classList.remove('show');
}

window.openSignUpModal = openSignUpModal;
window.closeSignUpModal = closeSignUpModal;

window.addEventListener('click', (event) => {
    if (event.target == signUpModal) {
        closeSignUpModal();
    }
});

// URL Validation
if (signUpImageUrlInput) {
    signUpImageUrlInput.addEventListener('input', () => {
        const url = signUpImageUrlInput.value.trim();
        const isValid = url.startsWith('https://wutheringwaves-dc.kurogames-global.com') && url.endsWith('.jpeg');
        if (signUpAnalyzeBtn) {
            signUpAnalyzeBtn.disabled = !isValid;
        }
    });
}

// Analyze Button Click
if (signUpAnalyzeBtn) {
    signUpAnalyzeBtn.addEventListener('click', () => {
        const imageUrl = signUpImageUrlInput.value.trim();
        if (!imageUrl) return;

        signUpAnalyzeBtn.disabled = true;
        showSignUpMessage('正在載入圖片...', 'success');
        signUpResultContainer.innerHTML = '<div style="color: var(--accent-gold);">處理中...</div>';

        // Proxy Fetch
        const proxyUrl = `${GCF_URL}?url=${encodeURIComponent(imageUrl)}`;

        const img = new Image();
        img.crossOrigin = 'Anonymous';

        img.onload = () => {
            showSignUpMessage('圖片載入成功', 'success');
            analyzeSignUpImage(img);
            signUpAnalyzeBtn.disabled = false;
        };

        img.onerror = () => {
            showSignUpMessage('圖片載入失敗', 'error');
            signUpResultContainer.innerHTML = '<div style="color: var(--accent-red);">圖片載入失敗</div>';
            signUpAnalyzeBtn.disabled = false;
        };

        img.src = proxyUrl;
    });
}

function showSignUpMessage(msg, type) {
    if (signUpMessage) {
        signUpMessage.textContent = msg;
        signUpMessage.className = `message ${type}`;
        signUpMessage.style.display = 'block';
        if (type === 'success') {
            setTimeout(() => { signUpMessage.style.display = 'none'; }, 2000);
        }
    }
}

function analyzeSignUpImage(img) {
    if (img.width !== 1920 || img.height !== 1080) {
        signUpResultContainer.innerHTML = `<div style="color: var(--accent-red);">圖片解析度錯誤: ${img.width}x${img.height} (需要 1920x1080)</div>`;
        return;
    }

    canvas.width = 1920;
    canvas.height = 1080;
    ctx.drawImage(img, 0, 0);

    const results = [];
    for (let i = 0; i < uidCoords.length; i++) {
        const [x, y, w, h] = uidCoords[i];
        const imageData = ctx.getImageData(x, y, w, h);
        const roiGray = getGrayROI(imageData);
        const result = recognizeROI(roiGray);
        results.push(result);
    }

    const chainLevel = 0;

    const resonatorResults = [];
    for (let i = 0; i < resonatorCoords.length; i++) {
        const [x, y, w, h] = resonatorCoords[i];
        const imageData = ctx.getImageData(x, y, w, h);
        const roiGray = getGrayROINormal(imageData);
        const result = recognizeResonator(roiGray);
        resonatorResults.push(result);
    }

    const differentColorAttributeResults = [];
    const recognizedResonator = resonatorResults[0]?.name || '';
    if (recognizedResonator === '漂泊者女' || recognizedResonator === '漂泊者') {
        for (let i = 0; i < DifferentColorAttributeCoords.length; i++) {
            const [x, y, w, h] = DifferentColorAttributeCoords[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROINormal(imageData);
            const result = recognizeDifferentColorAttribute(roiGray);
            differentColorAttributeResults.push(result);
        }
    }

    const recognizeBatch = (coords, func, isNormal = true) => {
        const res = [];
        for (let i = 0; i < coords.length; i++) {
            const [x, y, w, h] = coords[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = isNormal ? getGrayROINormal(imageData) : getGrayROI(imageData);
            res.push(func(roiGray, w, h));
        }
        return res;
    };

    const attributes1Results = recognizeBatch(AttributesCoords1, recognizeAttributes_1);
    const attributes2Results = recognizeBatch(AttributesCoords2, recognizeAttributes_2);
    const attributes3Results = recognizeBatch(AttributesCoords3, recognizeAttributes_3);
    const attributes4Results = recognizeBatch(AttributesCoords4, recognizeAttributes_4);
    const attributes5Results = recognizeBatch(AttributesCoords5, recognizeAttributes_5);

    const cost1Results = recognizeBatch(CostCoords1, recognizeConsumption_1, false);
    const cost2Results = recognizeBatch(CostCoords2, recognizeConsumption_2, false);
    const cost3Results = recognizeBatch(CostCoords3, recognizeConsumption_3, false);
    const cost4Results = recognizeBatch(CostCoords4, recognizeConsumption_4, false);
    const cost5Results = recognizeBatch(CostCoords5, recognizeConsumption_5, false);

    const processMainAffix = (coords, func, costResults, idx) => {
        const res = [];
        for (let i = 0; i < coords.length; i++) {
            const [x, y, w, h] = coords[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const result = func(roiGray);
            const costLevel = costResults[0]?.name?.replace(/^\d+_/, '') || '';
            const affixWithValue = addMainAffixValue(idx, result.name, costLevel);
            res.push({ ...result, nameWithValue: affixWithValue });
        }
        return res;
    };

    const mainAffix1Results = processMainAffix(MainTermCoords1, recognizeMainAffix_1, cost1Results, 1);
    const mainAffix2Results = processMainAffix(MainTermCoords2, recognizeMainAffix_2, cost2Results, 2);
    const mainAffix3Results = processMainAffix(MainTermCoords3, recognizeMainAffix_3, cost3Results, 3);
    const mainAffix4Results = processMainAffix(MainTermCoords4, recognizeMainAffix_4, cost4Results, 4);
    const mainAffix5Results = processMainAffix(MainTermCoords5, recognizeMainAffix_5, cost5Results, 5);

    const processSupAffix = (coords, func, posPrefix) => {
        const res = [];
        for (let i = 0; i < coords.length; i++) {
            const [x, y, w, h] = coords[i];
            const imageData = ctx.getImageData(x, y, w, h);
            const roiGray = getGrayROI(imageData);
            const affixResult = func(roiGray);
            const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const detailedResult = processSupAffixWithNumber(posPrefix, affixResult, fullImageData);
            res.push(detailedResult);
        }
        return res;
    };

    const supAffix1_1Results = processSupAffix(SupAffixCoords1_1, recognizeSupAffix_1_1, '1_1');
    const supAffix1_2Results = processSupAffix(SupAffixCoords1_2, recognizeSupAffix_1_2, '1_2');
    const supAffix1_3Results = processSupAffix(SupAffixCoords1_3, recognizeSupAffix_1_3, '1_3');
    const supAffix1_4Results = processSupAffix(SupAffixCoords1_4, recognizeSupAffix_1_4, '1_4');
    const supAffix1_5Results = processSupAffix(SupAffixCoords1_5, recognizeSupAffix_1_5, '1_5');

    const supAffix2_1Results = processSupAffix(SupAffixCoords2_1, recognizeSupAffix_2_1, '2_1');
    const supAffix2_2Results = processSupAffix(SupAffixCoords2_2, recognizeSupAffix_2_2, '2_2');
    const supAffix2_3Results = processSupAffix(SupAffixCoords2_3, recognizeSupAffix_2_3, '2_3');
    const supAffix2_4Results = processSupAffix(SupAffixCoords2_4, recognizeSupAffix_2_4, '2_4');
    const supAffix2_5Results = processSupAffix(SupAffixCoords2_5, recognizeSupAffix_2_5, '2_5');

    const supAffix3_1Results = processSupAffix(SupAffixCoords3_1, recognizeSupAffix_3_1, '3_1');
    const supAffix3_2Results = processSupAffix(SupAffixCoords3_2, recognizeSupAffix_3_2, '3_2');
    const supAffix3_3Results = processSupAffix(SupAffixCoords3_3, recognizeSupAffix_3_3, '3_3');
    const supAffix3_4Results = processSupAffix(SupAffixCoords3_4, recognizeSupAffix_3_4, '3_4');
    const supAffix3_5Results = processSupAffix(SupAffixCoords3_5, recognizeSupAffix_3_5, '3_5');

    const supAffix4_1Results = processSupAffix(SupAffixCoords4_1, recognizeSupAffix_4_1, '4_1');
    const supAffix4_2Results = processSupAffix(SupAffixCoords4_2, recognizeSupAffix_4_2, '4_2');
    const supAffix4_3Results = processSupAffix(SupAffixCoords4_3, recognizeSupAffix_4_3, '4_3');
    const supAffix4_4Results = processSupAffix(SupAffixCoords4_4, recognizeSupAffix_4_4, '4_4');
    const supAffix4_5Results = processSupAffix(SupAffixCoords4_5, recognizeSupAffix_4_5, '4_5');

    const supAffix5_1Results = processSupAffix(SupAffixCoords5_1, recognizeSupAffix_5_1, '5_1');
    const supAffix5_2Results = processSupAffix(SupAffixCoords5_2, recognizeSupAffix_5_2, '5_2');
    const supAffix5_3Results = processSupAffix(SupAffixCoords5_3, recognizeSupAffix_5_3, '5_3');
    const supAffix5_4Results = processSupAffix(SupAffixCoords5_4, recognizeSupAffix_5_4, '5_4');
    const supAffix5_5Results = processSupAffix(SupAffixCoords5_5, recognizeSupAffix_5_5, '5_5');

    const digits = results.map(r => r.digit).join('');
    const resonators = resonatorResults.map(r => r.name || '未知').join(', ');

    const removePrefix = (str) => str ? str.replace(/^\d+_/, '') : str;
    const parseMainAffix = (affixWithValue) => {
        if (!affixWithValue) return { name: '', value: '' };
        const parts = affixWithValue.split('+');
        return parts.length === 2 ? { name: parts[0], value: parts[1] } : { name: affixWithValue, value: '' };
    };

    let finalResonatorName = resonators;
    if (resonators === '漂泊者女' || resonators === '漂泊者') {
        const attributeResult = differentColorAttributeResults[0];
        if (attributeResult && attributeResult.name) {
            if (attributeResult.name === '衍射') finalResonatorName = '漂泊者';
            else if (attributeResult.name === '湮滅') finalResonatorName = '漂泊者-湮滅';
            else if (attributeResult.name === '氣動') finalResonatorName = '漂泊者-氣動';
        }
    }

    // Capture Debug Images
    const captureEchoDebugImages = (echoIdx) => {
        const idx1 = echoIdx + 1;
        const debugData = { Attribute: '', Cost: '', MainAffix: '', SubAffixes: [] };

        const getCoords = (name) => { try { return eval(name); } catch (e) { return null; } };

        // Attribute
        const attrCoords = getCoords(`AttributesCoords${idx1}`);
        if (attrCoords && attrCoords.length > 0) {
            const [x, y, w, h] = attrCoords[0];
            debugData.Attribute = cropImageAsBase64(x, y, w, h);
        }

        // Cost
        const costCoords = getCoords(`CostCoords${idx1}`);
        if (costCoords && costCoords.length > 0) {
            const [x, y, w, h] = costCoords[0];
            debugData.Cost = cropImageAsBase64(x, y, w, h);
        }

        // Main Affix
        const mainCoords = getCoords(`MainTermCoords${idx1}`);
        if (mainCoords && mainCoords.length > 0) {
            const [x, y, w, h] = mainCoords[0];
            debugData.MainAffix = cropImageAsBase64(x, y, w, h);
        }

        // Sub Affixes
        for (let subIdx = 1; subIdx <= 5; subIdx++) {
            const subData = { Name: '', Value: '' };
            const nameCoords = getCoords(`SupAffixCoords${idx1}_${subIdx}`);
            if (nameCoords && nameCoords.length > 0) {
                const [x, y, w, h] = nameCoords[0];
                subData.Name = cropImageAsBase64(x, y, w, h);
            }
            const valCoord = SupAffixNumberCoords[`${idx1}_${subIdx}`];
            if (valCoord) {
                const [x, y, w, h] = valCoord;
                subData.Value = cropImageAsBase64(x, y, w, h);
            }
            debugData.SubAffixes.push(subData);
        }
        return debugData;
    };

    const buildEcho = (id, costRes, attrRes, mainRes, supResArray, echoIndex) => {
        const parsedMain = parseMainAffix(mainRes[0]?.nameWithValue || '');
        return {
            Id: id,
            DebugImages: captureEchoDebugImages(echoIndex),
            Cost: removePrefix(costRes[0]?.name || '未知'),
            Attributes: removePrefix(attrRes[0]?.name || '未知'),
            AllEchoAffix: [
                { Name: removePrefix(parsedMain.name), Number: parsedMain.value, Points: 0 },
                { Name: removePrefix(supResArray[0][0]?.affix || ''), Number: supResArray[0][0]?.value || '', Points: 0 },
                { Name: removePrefix(supResArray[1][0]?.affix || ''), Number: supResArray[1][0]?.value || '', Points: 0 },
                { Name: removePrefix(supResArray[2][0]?.affix || ''), Number: supResArray[2][0]?.value || '', Points: 0 },
                { Name: removePrefix(supResArray[3][0]?.affix || ''), Number: supResArray[3][0]?.value || '', Points: 0 },
                { Name: removePrefix(supResArray[4][0]?.affix || ''), Number: supResArray[4][0]?.value || '', Points: 0 }
            ],
            Points: 0
        };
    };

    const list = [
        buildEcho(0, cost1Results, attributes1Results, mainAffix1Results, [supAffix1_1Results, supAffix1_2Results, supAffix1_3Results, supAffix1_4Results, supAffix1_5Results], 0),
        buildEcho(0, cost2Results, attributes2Results, mainAffix2Results, [supAffix2_1Results, supAffix2_2Results, supAffix2_3Results, supAffix2_4Results, supAffix2_5Results], 1),
        buildEcho(0, cost3Results, attributes3Results, mainAffix3Results, [supAffix3_1Results, supAffix3_2Results, supAffix3_3Results, supAffix3_4Results, supAffix3_5Results], 2),
        buildEcho(0, cost4Results, attributes4Results, mainAffix4Results, [supAffix4_1Results, supAffix4_2Results, supAffix4_3Results, supAffix4_4Results, supAffix4_5Results], 3),
        buildEcho(0, cost5Results, attributes5Results, mainAffix5Results, [supAffix5_1Results, supAffix5_2Results, supAffix5_3Results, supAffix5_4Results, supAffix5_5Results], 4)
    ];

    const jsonResult = {
        Name: finalResonatorName,
        NameImage: resonators,
        UID: digits,
        ValidAffix: '',
        Total共鳴效率: '',
        Total總分: '',
        NumberOfStars: chainLevel,
        list: list
    };

    window.currentJsonResult = jsonResult;

    recalculateScore(jsonResult);
    renderSignUpResult(jsonResult);
}

function renderSignUpResult(data) {
    if (!data) return;

    const stars = Array(6).fill().map((_, i) =>
        `<svg class="star ${i < (data.NumberOfStars || 0) ? '' : 'empty'}" viewBox="0 0 24 24">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
        </svg>`
    ).join('');

    const totalScore = parseFloat(data.Total總分) || 0;
    const totalScoreHTML = `<div class="stat-value">${totalScore.toFixed(2)}</div>`;

    let equipmentCards = '';
    if (Array.isArray(data.list)) {
        data.list.forEach((item, index) => {
            const filteredAffixes = (item.AllEchoAffix || []).filter(affix => affix.Id !== 0);
            const itemScore = parseFloat(item.Points) || 0;
            let itemScoreColor = itemScore >= 8 ? 'score-high' : (itemScore < 5 ? 'score-low' : 'score-medium');
            const costVal = item.Cost || 1;
            let shortName = item.Attributes || '聲骸';
            const attrPic = attributesProfilePicture[shortName];
            let attrDisplay = attrPic
                ? `<img src="${attrPic}" style="width: 24px; height: 24px; object-fit: contain; vertical-align: middle;">`
                : shortName;

            let affixRows = filteredAffixes.map(affix => {
                const pts = parseFloat(affix.Points) || 0;
                const ptClass = pts > 0 ? 'point-pos' : 'point-zero';
                return `<tr><td class="affix-name">${affix.Name}</td><td class="affix-value">${affix.Number}</td><td class="affix-point ${ptClass}">${pts.toFixed(2)}</td></tr>`;
            }).join('');

            equipmentCards += `
                <div class="equipment-card" style="padding: 10px; font-size: 0.9rem;">
                    <div class="equipment-header-row">
                        <span class="cost-num cost-${costVal}">${costVal}</span>
                        <span class="echo-name">${attrDisplay}</span>
                        <span class="echo-score ${itemScoreColor}">${itemScore.toFixed(2)}</span>
                        <button class="switch-btn" style="padding: 2px 8px; font-size: 0.8rem; margin-left: auto;" onclick="openDebugModal(${index})">回報</button>
                    </div>
                    <table class="affix-table">${affixRows}</table>
                </div>
            `;
        });
    }

    const profilePicUrl = resonatorsProfilePicture[data.Name || ''];
    const html = `
        <div class="landscape-layout" style="width: 100%;">
            <div class="character-card">
                <div class="character-header">
                    <div class="avatar-container">
                        ${profilePicUrl ? `<img src="${profilePicUrl}" class="character-avatar">` : `<div class="character-avatar" style="background:#333;"></div>`}
                        <div class="character-stars">${stars}</div>
                    </div>
                    <div class="character-info">
                        <h1 style="margin-bottom: 0;">${data.Name || '未知角色'}</h1>
                        <div class="character-uid">${data.UID || ''}</div>
                    </div>
                </div>
                <div class="stats-grid">${totalScoreHTML}</div>
            </div>
            <div class="equipment-section">
                <div class="equipment-grid landscape" style="grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); padding: 1rem;">
                    ${equipmentCards}
                </div>
            </div>
            <div style="margin-top: 1rem;">
                <button class="btn" id="joinRankBtn" onclick="submitToRankForm()">參加</button>
            </div>
        </div>
    `;

    signUpResultContainer.innerHTML = html;
}

function validateSignUpData(data, event) {
    if (!event) return { valid: true };

    const errors = [];

    // 1. 檢查角色名稱
    if (data.Name !== event.name) {
        errors.push(`角色不符：需要 ${event.name}，辨識為 ${data.Name}`);
    }

    // 2. 檢查 Cost 分佈
    const detectedCosts = data.list.map(e => parseInt(e.Cost) || 0).sort((a, b) => b - a);
    const requiredCosts = [...event.cost_distribution].map(c => parseInt(c)).sort((a, b) => b - a);
    if (JSON.stringify(detectedCosts) !== JSON.stringify(requiredCosts)) {
        errors.push(`Cost 組合不符：需要 ${requiredCosts.join('')}，辨識為 ${detectedCosts.filter(c => c > 0).join('')}`);
    }

    // 3. 檢查套裝效果
    const attrCounts = {};
    data.list.forEach(e => {
        attrCounts[e.Attributes] = (attrCounts[e.Attributes] || 0) + 1;
    });

    if (event.echo_sets && Array.isArray(event.echo_sets)) {
        event.echo_sets.forEach(setReq => {
            const possibleNames = setReq.name.split('/');
            const meetsRequirement = possibleNames.some(name => (attrCounts[name] || 0) >= setReq.quantity);

            if (!meetsRequirement) {
                if (possibleNames.length > 1) {
                    errors.push(`套裝不符：${possibleNames.join(' 或 ')} 其中之一需要 ${setReq.quantity} 件`);
                } else {
                    errors.push(`套裝不符：${setReq.name} 需要 ${setReq.quantity} 件，辨識為 ${attrCounts[setReq.name] || 0} 件`);
                }
            }
        });
    }

    // 4. 檢查主詞條
    if (event.main_stats) {
        data.list.forEach((echo, idx) => {
            const costKey = `cost_${echo.Cost}`;
            const allowedStats = event.main_stats[costKey];
            const detectedStat = echo.AllEchoAffix[0].Name;
            if (allowedStats && allowedStats.length > 0 && !allowedStats.includes(detectedStat)) {
                errors.push(`第 ${idx + 1} 個聲骸 (${echo.Cost} Cost) 主詞條不符：${detectedStat} 不在允許清單中 (${allowedStats.join('、')})`);
            }
        });
    }

    return {
        valid: errors.length === 0,
        message: errors.join('\n')
    };
}

function submitToRankForm() {
    const data = window.currentJsonResult;
    const event = window.currentActiveEvent;
    const imageUrl = document.getElementById('signUpImageUrlInput').value.trim();
    const btn = document.getElementById('joinRankBtn');

    if (!data || !imageUrl) {
        alert('無效的資料或圖片網址');
        return;
    }

    // 執行參賽條件驗證
    const validation = validateSignUpData(data, event);
    if (!validation.valid) {
        alert('不符合參賽條件：\n' + validation.message);
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.textContent = '送出中...';
    }

    const formUrl = "https://docs.google.com/forms/d/e/1FAIpQLSePcICExGTTBE7NoiwTMMTHHyKKUi2zhUBAymIJKz5425GFuQ/formResponse";
    const formData = new FormData();

    formData.append("entry.2051548718", data.UID || "");
    formData.append("entry.1436373707", data.Name || "");
    formData.append("entry.432559864", data.Total總分 || "");
    formData.append("entry.838687698", imageUrl);

    fetch(formUrl, {
        method: "POST",
        mode: "no-cors",
        body: formData
    })
        .then(() => {
            alert('已送出！');
            closeSignUpModal();
            if (window.fetchRankDataLive) window.fetchRankDataLive();
        })
        .catch((error) => {
            console.error('Error:', error);
            alert('送出失敗，請稍後再試。');
            if (btn) {
                btn.disabled = false;
                btn.textContent = '參加';
            }
        });
}
