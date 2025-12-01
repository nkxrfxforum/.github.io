// 同網域、不同資料夾的 JSON
fetch("../data/templates.json")
    .then(res => res.json())        // 讀成 JSON
    .then(json => {
        console.log("成功讀到 JSON：", json);

        // 示範使用 JSON 內容
        console.log("6.3% width =", json["6.3%"].width);
        console.log("6.3% data  =", json["6.3%"].data);

        // 示範讀另一個
        console.log("9.1% height =", json["9.1%"].height);
    })
    .catch(err => {
        console.error("讀取 JSON 發生錯誤：", err);
    });
