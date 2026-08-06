// OrderList.jsx — 订单列表(GET /api/orders)
import React from 'react';
import { useAPIData } from '../wdpp.js';

export default function OrderList() {
  const { data: orders, loading } = useAPIData('/api/orders');

  return (
    <section className="card" data-wdpp-section="GET /api/orders">
      <h2>📦 Orders</h2>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <ul>
          {orders?.map((order) => (
            <li key={order.id}>
              {/* 字符串拼接 '#' + order.id: LabeledBox 自动 valueOf → 字符串拼接 */}
              <strong>#{order.id}</strong> — {order.product} — ${order.price} — {order.status}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
