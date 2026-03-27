import { useState, useEffect } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  BarElement,
  Tooltip,
  Filler,
} from "chart.js";
import { Line, Bar } from "react-chartjs-2";
import { api, type FollowerSnapshot, type ProfileSnapshot } from "../api/client";
import { useToast } from "../components/Toast";
import { chartColors, chartGrid, chartTick } from "../lib/chartTheme";

ChartJS.register(
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  BarElement,
  Tooltip,
  Filler
);

export default function Followers() {
  const { showError } = useToast();
  const [followers, setFollowers] = useState<FollowerSnapshot[]>([]);
  const [profile, setProfile] = useState<ProfileSnapshot[]>([]);

  useEffect(() => {
    api.followers().then((r) => setFollowers(r.snapshots)).catch(() => showError("Failed to load follower data"));
    api.profile().then((r) => setProfile(r.snapshots)).catch(() => showError("Failed to load profile data"));
  }, []);

  const noData = followers.length === 0 && profile.length === 0;

  const latestFollowers = followers.length > 0 ? followers[followers.length - 1].total_followers : null;
  const weeklyGrowth = followers.length > 1
    ? followers.slice(-7).reduce((s, f) => s + (f.new_followers ?? 0), 0)
    : null;
  const latestProfileViews = profile.length > 0 ? profile[profile.length - 1].profile_views : null;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold [text-wrap:balance] animate-fade-up">Followers & Profile</h2>

      {noData ? (
        <div className="bg-surface-1 border border-border rounded-lg p-16 text-center animate-fade-up">
          <svg className="w-10 h-10 text-text-muted/40 mx-auto mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round" />
          </svg>
          <p className="text-sm font-medium text-text-secondary">No follower data yet</p>
          <p className="text-xs text-text-muted mt-1 [text-wrap:pretty]">The extension syncs follower and profile data from your LinkedIn analytics dashboard.</p>
        </div>
      ) : (
        <>
          {/* KPI Summary Row */}
          <div className="grid grid-cols-3 gap-4 animate-fade-up" style={{ animationDelay: "60ms" }}>
            <div className="bg-surface-1 border border-border rounded-lg p-4">
              <div className="text-xs text-text-muted uppercase tracking-wider">Total Followers</div>
              <div className="text-2xl font-semibold font-mono tabular-nums mt-1">{latestFollowers?.toLocaleString() ?? "--"}</div>
            </div>
            <div className="bg-surface-1 border border-border rounded-lg p-4">
              <div className="text-xs text-text-muted uppercase tracking-wider">7-Day Growth</div>
              <div className={`text-2xl font-semibold font-mono tabular-nums mt-1 ${weeklyGrowth != null && weeklyGrowth > 0 ? "text-positive" : ""}`}>
                {weeklyGrowth != null ? `${weeklyGrowth >= 0 ? "+" : ""}${weeklyGrowth}` : "--"}
              </div>
            </div>
            <div className="bg-surface-1 border border-border rounded-lg p-4">
              <div className="text-xs text-text-muted uppercase tracking-wider">Profile Views</div>
              <div className="text-2xl font-semibold font-mono tabular-nums mt-1">{latestProfileViews?.toLocaleString() ?? "--"}</div>
            </div>
          </div>

          {/* Hero chart — Follower Growth */}
          {followers.length > 0 && (
            <div className="bg-surface-1 border border-accent/20 rounded-lg p-6 animate-fade-up" style={{ animationDelay: "120ms" }}>
              <h3 className="text-sm font-medium text-text-primary mb-4">
                Follower Growth
              </h3>
              <div className="h-72">
                <Line
                  data={{
                    labels: followers.map((f) => f.date),
                    datasets: [
                      {
                        label: "Total Followers",
                        data: followers.map((f) => f.total_followers),
                        borderColor: chartColors.accent,
                        backgroundColor: chartColors.accentBg,
                        fill: true,
                        tension: 0.3,
                        pointRadius: 2,
                      },
                    ],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                      x: { ticks: chartTick, grid: chartGrid },
                      y: { ticks: chartTick, grid: chartGrid },
                    },
                  }}
                />
              </div>
            </div>
          )}

          {/* Supporting charts — compact */}
          <div className="grid md:grid-cols-3 gap-4 animate-fade-up" style={{ animationDelay: "180ms" }}>
            {/* New followers per day */}
            {followers.length > 1 && (
              <div className="bg-surface-1 border border-border rounded-lg p-4">
                <h3 className="text-sm font-medium text-text-secondary mb-3">
                  New Followers / Day
                </h3>
                <div className="h-44">
                  <Bar
                    data={{
                      labels: followers.slice(1).map((f) => f.date),
                      datasets: [
                        {
                          label: "New Followers",
                          data: followers
                            .slice(1)
                            .map((f) => f.new_followers ?? 0),
                          backgroundColor: followers
                            .slice(1)
                            .map((f) =>
                              (f.new_followers ?? 0) >= 0
                                ? chartColors.positive
                                : chartColors.negative
                            ),
                          borderRadius: 2,
                        },
                      ],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      scales: {
                        x: { ticks: chartTick, grid: chartGrid },
                        y: { ticks: chartTick, grid: chartGrid },
                      },
                    }}
                  />
                </div>
              </div>
            )}

            {/* Profile views */}
            {profile.length > 0 && (
              <div className="bg-surface-1 border border-border rounded-lg p-4">
                <h3 className="text-sm font-medium text-text-secondary mb-3">
                  Profile Views (90d)
                </h3>
                <div className="h-44">
                  <Line
                    data={{
                      labels: profile.map((p) => p.date),
                      datasets: [
                        {
                          label: "Profile Views",
                          data: profile.map((p) => p.profile_views ?? 0),
                          borderColor: chartColors.purple,
                          backgroundColor: chartColors.purpleBg,
                          fill: true,
                          tension: 0.3,
                          pointRadius: 2,
                        },
                      ],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      scales: {
                        x: { ticks: chartTick, grid: chartGrid },
                        y: { ticks: chartTick, grid: chartGrid },
                      },
                    }}
                  />
                </div>
              </div>
            )}

            {/* Search appearances */}
            {profile.length > 0 && (
              <div className="bg-surface-1 border border-border rounded-lg p-4">
                <h3 className="text-sm font-medium text-text-secondary mb-3">
                  Appearances
                </h3>
                <div className="h-44">
                  <Line
                    data={{
                      labels: profile.map((p) => p.date),
                      datasets: [
                        {
                          label: "All Appearances",
                          data: profile.map((p) => p.all_appearances ?? 0),
                          borderColor: chartColors.warning,
                          tension: 0.3,
                          pointRadius: 2,
                        },
                        {
                          label: "Search",
                          data: profile.map(
                            (p) => p.search_appearances ?? 0
                          ),
                          borderColor: chartColors.positive,
                          tension: 0.3,
                          pointRadius: 2,
                        },
                      ],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      scales: {
                        x: { ticks: chartTick, grid: chartGrid },
                        y: { ticks: chartTick, grid: chartGrid },
                      },
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
