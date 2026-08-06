// ConditionalDemo.jsx — 条件渲染演示
import React from 'react';
import { useAPIData } from '../wdpp.js';

export default function ConditionalDemo() {
  const { data: user } = useAPIData('/api/user');

  return (
    <section className="card" data-wdpp-section="GET /api/user">
      <h2>🔀 Conditional Rendering</h2>
      {user?.isVIP ? (
        <div>
          <span className="badge vip">VIP Customer</span>
          <span>🎁 20% off all orders</span>
        </div>
      ) : (
        <div>
          <span className="badge regular">Regular Customer</span>
          <span>No discount applied</span>
        </div>
      )}
    </section>
  );
}
