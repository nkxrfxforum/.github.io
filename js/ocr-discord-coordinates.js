// UID 每個字元的座標 [ x, y, width, height ]
var uidCoords = [
    [92, 116, 11, 15],
    [103, 116, 11, 15],
    [114, 116, 11, 15],
    [124, 116, 11, 15],
    [135, 116, 11, 15],
    [145, 116, 11, 15],
    [156, 116, 11, 15],
    [166, 116, 11, 15],
    [177, 116, 11, 15]
];

// 角色判定 座標 [ x, y, width, height ]
var resonatorCoords = [[350, 250, 100, 100]];

// 鏈度判定 座標 [ x, y, width, height ]
var NumberOfStarsCoords = [
    [180, 565, 20, 20],
    [253, 565, 20, 20],
    [334, 565, 20, 20],
    [415, 565, 20, 20],
    [495, 565, 20, 20],
    [574, 565, 20, 20]
];

// 屬性 N [ x, y, width, height ]
var AttributesCoords1 = [
    [267, 662, 50, 50]
];
var AttributesCoords2 = [
    [640, 662, 50, 50]
];
var AttributesCoords3 = [
    [1014, 662, 50, 50]
];
var AttributesCoords4 = [
    [1389, 662, 50, 50]
];
var AttributesCoords5 = [
    [1763, 662, 50, 50]
];

// 副詞條數值座標 '副詞條N_編號' : [ x, y, width, height ]
var SupAffixNumberCoords = {
    '1_1': [300, 884, 75, 22],
    '1_2': [300, 918, 75, 22],
    '1_3': [300, 952, 75, 22],
    '1_4': [300, 986, 75, 22],
    '1_5': [300, 1020, 75, 22],
    '2_1': [675, 884, 75, 22],
    '2_2': [675, 918, 75, 22],
    '2_3': [675, 952, 75, 22],
    '2_4': [675, 986, 75, 22],
    '2_5': [675, 1020, 75, 22],
    '3_1': [1050, 884, 75, 22],
    '3_2': [1050, 918, 75, 22],
    '3_3': [1050, 952, 75, 22],
    '3_4': [1050, 986, 75, 22],
    '3_5': [1050, 1020, 75, 22],
    '4_1': [1425, 884, 75, 22],
    '4_2': [1425, 918, 75, 22],
    '4_3': [1425, 952, 75, 22],
    '4_4': [1425, 986, 75, 22],
    '4_5': [1425, 1020, 75, 22],
    '5_1': [1800, 884, 75, 22],
    '5_2': [1800, 918, 75, 22],
    '5_3': [1800, 952, 75, 22],
    '5_4': [1800, 986, 75, 22],
    '5_5': [1800, 1020, 75, 22]
};

// Cost N [ x, y, width, height ]
var CostCoords1 = [
    [322, 662, 50, 50]
];
var CostCoords2 = [
    [695, 662, 50, 50]
];
var CostCoords3 = [
    [1069, 662, 50, 50]
];
var CostCoords4 = [
    [1444, 662, 50, 50]
];
var CostCoords5 = [
    [1818, 662, 50, 50]
];

// 主詞條N [ x, y, width, height ]
var MainTermCoords1 = [
    [237, 723, 133, 23]
];
var MainTermCoords2 = [
    [612, 723, 133, 23]
];
var MainTermCoords3 = [
    [986, 723, 133, 23]
];
var MainTermCoords4 = [
    [1361, 723, 133, 23]
];
var MainTermCoords5 = [
    [1733, 723, 133, 23]
];

// 副詞條1_N [ x, y, width, height ]
var SupAffixCoords1_1 = [
    [66, 884, 88, 22]
];
var SupAffixCoords1_2 = [
    [66, 918, 88, 22]
];
var SupAffixCoords1_3 = [
    [66, 952, 88, 22]
];
var SupAffixCoords1_4 = [
    [66, 985, 88, 23]
];
var SupAffixCoords1_5 = [
    [66, 1020, 88, 22]
];

// 副詞條2_N [ x, y, width, height ]
var SupAffixCoords2_1 = [
    [444, 884, 88, 22]
];
var SupAffixCoords2_2 = [
    [444, 918, 88, 22]
];
var SupAffixCoords2_3 = [
    [444, 952, 88, 22]
];
var SupAffixCoords2_4 = [
    [444, 985, 88, 23]
];
var SupAffixCoords2_5 = [
    [444, 1020, 88, 22]
];

// 副詞條3_N [ x, y, width, height ]
var SupAffixCoords3_1 = [
    [818, 884, 88, 22]
];
var SupAffixCoords3_2 = [
    [818, 918, 88, 22]
];
var SupAffixCoords3_3 = [
    [818, 952, 88, 22]
];
var SupAffixCoords3_4 = [
    [818, 985, 88, 23]
];
var SupAffixCoords3_5 = [
    [818, 1020, 88, 22]
];

// 副詞條4_N [ x, y, width, height ]
var SupAffixCoords4_1 = [
    [1192, 884, 88, 22]
];
var SupAffixCoords4_2 = [
    [1192, 918, 88, 22]
];
var SupAffixCoords4_3 = [
    [1192, 952, 88, 22]
];
var SupAffixCoords4_4 = [
    [1192, 985, 88, 23]
];
var SupAffixCoords4_5 = [
    [1192, 1020, 88, 22]
];

// 副詞條5_N [ x, y, width, height ]
var SupAffixCoords5_1 = [
    [1566, 884, 88, 22]
];
var SupAffixCoords5_2 = [
    [1566, 918, 88, 22]
];
var SupAffixCoords5_3 = [
    [1566, 952, 88, 22]
];
var SupAffixCoords5_4 = [
    [1566, 985, 88, 23]
];
var SupAffixCoords5_5 = [
    [1566, 1020, 88, 22]
];

// 顏色不同的漂泊者屬性判定座標 [ x, y, width, height ]
var DifferentColorAttributeCoords = [
    [18, 27, 46, 45]
];