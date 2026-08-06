// UserCard.jsx — 用户卡片(GET /api/user)
import React from 'react';
import { useAPIData } from '../wdpp.js';

export default function UserCard() {
  const { data: user, loading, error } = useAPIData('/api/user');

  if (loading) return <section className="card"><h2>👤 User Profile</h2><p>Loading...</p></section>;
  if (error) return <section className="card"><h2>👤 User Profile</h2><p>Error: {error.message}</p></section>;
  if (!user) return <section className="card"><h2>👤 User Profile</h2><p>No data</p></section>;

  // 字段读取 — user 是 Proxy,每个属性返回 LabeledBox(value, ['GET /api/user'])
  // React 把 LabeledBox 字符串化(valueOf 自动)→ 显示原始值,DOM sink 读 .apis 设 title
  return (
    <section className="card" data-wdpp-section="GET /api/user">
      <h2>👤 User Profile</h2>
      <div className="row">
        <span className="label">Name:</span>
        <span className="value">{user.name}</span>
      </div>
      <div className="row">
        <span className="label">Email:</span>
        <span className="value">{user.email}</span>
      </div>
      <div className="row">
        <span className="label">City:</span>
        <span className="value">{user.city}</span>
      </div>
      <div className="row">
        <span className="label">Member since:</span>
        <span className="value">{user.memberSince}</span>
      </div>
      <div className="row">
        <span className="label">VIP Status:</span>
        <span className="value">{user.isVIP ? '👑 VIP' : 'Regular'}</span>
      </div>
    </section>
  );
}
