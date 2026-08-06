// AggregationDemo.jsx — 聚合计算演示(GET /api/orders + GET /api/products)
import React from 'react';
import { useAPIData } from '../wdpp.js';

export default function AggregationDemo() {
  const { data: orders } = useAPIData('/api/orders');
  const { data: products } = useAPIData('/api/products');

  // 聚合:来自 /api/orders 的 totalPrice + totalQty
  const totalPrice = orders?.reduce((sum, o) => sum + o.price, 0) || 0;
  const totalQty = orders?.reduce((sum, o) => sum + (o.qty || 0), 0) || 0;
  const productCount = products?.length || 0;

  return (
    <section className="card" data-wdpp-section="GET /api/orders">
      <h2>🧮 Aggregation</h2>
      <div className="row">
        <span className="label">Total Price:</span>
        <span className="value">${totalPrice.toFixed(2)}</span>
      </div>
      <div className="row">
        <span className="label">Total Qty:</span>
        <span className="value">{totalQty} items</span>
      </div>
      <div className="row">
        <span className="label">Product Count:</span>
        <span className="value">{productCount} products</span>
      </div>
    </section>
  );
}
