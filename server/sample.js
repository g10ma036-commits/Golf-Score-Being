'use strict';
// サンプルデータを SQLite に書き込む（生成ロジックはスマホ単独版と共用: public/js/shared/sample.js）
const shared = require('../public/js/shared/sample.js');

function generateSample(db) {
  shared.generateSample((table, row) => {
    const cols = Object.keys(row);
    const sql = `INSERT INTO ${table}(${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
    return Number(db.run(sql, ...Object.values(row)).lastInsertRowid);
  });
}

module.exports = { generateSample };
