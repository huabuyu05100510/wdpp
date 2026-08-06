// StatsPanel.jsx — 统计面板(GET /api/stats)
import React from 'react';
import { useAPIData } from '../wdpp.js';

export default function StatsPanel() {
  const { data: stats, loading } = useAPIData('/api/stats');

  return (
    <section className="card" data-wdpp-section="GET /api/stats">
      <h2>📊 Dashboard Stats</h2>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <>
          <div className="row">
            <span className="label">Total Users:</span>
            <span className="value">{stats?.totalUsers.toLocaleString()}</span>
          </div>
          <div className="row">
            <span className="label">Total Orders:</span>
            <span className="value">{stats?.totalOrders.toLocaleString()}</span>
          </div>
          <div className="row">
            <span className="label">Revenue:</span>
            <span className="value">${stats?.revenue.toLocaleString()}</span>
          </div>
        </>
      )}
    </section>
  );
}
