import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Calculator,
  DollarSign,
  Users,
  Target,
  Search,
  Cpu,
  ArrowRight,
  TrendingUp,
  Shield,
} from "lucide-react";

const RANK_CHECKS_PER_MONTH = 120;
const COST_PER_RANK_CHECK = 0.0006;
const AI_INTELLIGENCE_FLAT = 125;
const COST_PER_RESEARCH_CREDIT = 0.02;

const ENTERPRISE_DEMO_LINK = "https://calendly.com/designmemarketing";

const fmt = (n: number) =>
  n >= 1000
    ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$${n.toFixed(2)}`;

const EnterpriseCalculatorPage = () => {
  const navigate = useNavigate();

  const [dashboards, setDashboards] = useState<number>(100);
  const [keywords, setKeywords] = useState<number>(2000);
  const [credits, setCredits] = useState<number>(1000);
  const [teamUsers, setTeamUsers] = useState<number>(25);
  const [customPrice, setCustomPrice] = useState<string>("");

  const calc = useMemo(() => {
    const rankCost = keywords * RANK_CHECKS_PER_MONTH * COST_PER_RANK_CHECK;
    const aiCost = AI_INTELLIGENCE_FLAT;
    const creditsCost = credits * COST_PER_RESEARCH_CREDIT;
    const totalCost = rankCost + aiCost + creditsCost;
    const margin90 = totalCost / 0.1;
    const margin95 = totalCost / 0.05;
    return { rankCost, aiCost, creditsCost, totalCost, margin90, margin95 };
  }, [keywords, credits]);

  const handleCreate = () => {
    const price = parseFloat(customPrice);
    if (!price || price <= 0) return;
    const params = new URLSearchParams({
      tier: "enterprise",
      customPricing: price.toString(),
      dashboards: dashboards.toString(),
      keywords: keywords.toString(),
      credits: credits.toString(),
      teamUsers: teamUsers.toString(),
    });
    navigate(`/agency/agencies?create=1&${params.toString()}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-violet-50/30 p-8">
      {/* Header */}
      <div className="relative mb-10 overflow-hidden rounded-2xl bg-gradient-to-r from-gray-900 via-gray-800 to-violet-900 p-8 shadow-lg">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA1KSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3QgZmlsbD0idXJsKCNnKSIgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIvPjwvc3ZnPg==')] opacity-50" />
        <div className="relative flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm">
            <Calculator className="h-7 w-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white md:text-3xl">Enterprise Calculator</h1>
            <p className="mt-1 text-sm text-gray-300">Internal pricing tool — calculate cost and margin for custom enterprise accounts</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-5">
        {/* LEFT: Input Fields */}
        <div className="xl:col-span-2">
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-6 py-5">
              <h2 className="text-lg font-semibold text-gray-900">Account Configuration</h2>
              <p className="mt-1 text-xs text-gray-500">Enter the client's requirements to calculate pricing</p>
            </div>
            <div className="space-y-5 p-6">
              <div>
                <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-gray-700">
                  <Users className="h-4 w-4 text-primary-500" />
                  Client Dashboards
                </label>
                <input
                  type="number"
                  min={1}
                  value={dashboards}
                  onChange={(e) => setDashboards(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-200 focus:outline-none"
                />
                <p className="mt-1 text-xs text-gray-400">+ 1 free agency dashboard (always included)</p>
              </div>

              <div>
                <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-gray-700">
                  <Target className="h-4 w-4 text-teal-500" />
                  Tracked Keywords (account-wide)
                </label>
                <input
                  type="number"
                  min={1}
                  value={keywords}
                  onChange={(e) => setKeywords(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-200 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-gray-700">
                  <Search className="h-4 w-4 text-violet-500" />
                  Research Credits / Month
                </label>
                <input
                  type="number"
                  min={0}
                  value={credits}
                  onChange={(e) => setCredits(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-violet-500 focus:ring-2 focus:ring-violet-200 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-gray-700">
                  <Users className="h-4 w-4 text-amber-500" />
                  Team Users
                </label>
                <input
                  type="number"
                  min={1}
                  value={teamUsers}
                  onChange={(e) => setTeamUsers(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none"
                />
              </div>

              {/* Fixed features callout */}
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Fixed for all Enterprise</p>
                <div className="mt-2 space-y-1.5 text-sm text-gray-700">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-3.5 w-3.5 text-gray-400" />
                    <span>Rank updates every 6 hours (4x daily)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Cpu className="h-3.5 w-3.5 text-gray-400" />
                    <span>Daily AI Intelligence updates</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: Calculated Output */}
        <div className="space-y-6 xl:col-span-3">
          {/* Cost Breakdown */}
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-6 py-5">
              <h2 className="text-lg font-semibold text-gray-900">Our Monthly Cost</h2>
              <p className="mt-1 text-xs text-gray-500">Auto-calculated based on inputs</p>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-700">Rank Tracking</p>
                    <p className="text-xs text-gray-400">
                      {keywords.toLocaleString()} keywords x {RANK_CHECKS_PER_MONTH} checks x ${COST_PER_RANK_CHECK}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-gray-900">{fmt(calc.rankCost)}</span>
                </div>

                <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-700">AI Intelligence</p>
                    <p className="text-xs text-gray-400">Flat monthly fee</p>
                  </div>
                  <span className="text-sm font-bold text-gray-900">{fmt(calc.aiCost)}</span>
                </div>

                <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-700">Research Credits</p>
                    <p className="text-xs text-gray-400">
                      {credits.toLocaleString()} credits x ${COST_PER_RESEARCH_CREDIT}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-gray-900">{fmt(calc.creditsCost)}</span>
                </div>

                <div className="border-t border-gray-200 pt-4">
                  <div className="flex items-center justify-between">
                    <span className="text-base font-semibold text-gray-900">Total Monthly Cost</span>
                    <span className="text-xl font-extrabold text-gray-900">{fmt(calc.totalCost)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Suggested Pricing */}
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-6 py-5">
              <h2 className="text-lg font-semibold text-gray-900">Suggested Pricing</h2>
            </div>
            <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-3">
              <div className="rounded-xl border-2 border-red-100 bg-gradient-to-b from-red-50/50 to-white p-5 text-center">
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                  <DollarSign className="h-5 w-5 text-red-600" />
                </div>
                <p className="text-xs font-medium uppercase tracking-wider text-red-500">Our Cost</p>
                <p className="mt-1 text-2xl font-extrabold text-red-700">{fmt(calc.totalCost)}</p>
                <p className="text-xs text-red-400">/month</p>
              </div>

              <div className="rounded-xl border-2 border-amber-100 bg-gradient-to-b from-amber-50/50 to-white p-5 text-center">
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
                  <TrendingUp className="h-5 w-5 text-amber-600" />
                </div>
                <p className="text-xs font-medium uppercase tracking-wider text-amber-500">90% Margin</p>
                <p className="mt-1 text-2xl font-extrabold text-amber-700">{fmt(calc.margin90)}</p>
                <p className="text-xs text-amber-400">/month</p>
              </div>

              <div className="rounded-xl border-2 border-emerald-100 bg-gradient-to-b from-emerald-50/50 to-white p-5 text-center">
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
                  <Shield className="h-5 w-5 text-emerald-600" />
                </div>
                <p className="text-xs font-medium uppercase tracking-wider text-emerald-500">95% Margin</p>
                <p className="mt-1 text-2xl font-extrabold text-emerald-700">{fmt(calc.margin95)}</p>
                <p className="text-xs text-emerald-400">/month</p>
              </div>
            </div>
          </div>

          {/* Final Price + Create */}
          <div className="rounded-2xl border-2 border-gray-900 bg-gradient-to-br from-gray-900 to-gray-800 p-6 shadow-lg">
            <h2 className="text-lg font-bold text-white">Set Final Price & Create Account</h2>
            <p className="mt-1 text-sm text-gray-400">Review the numbers above, then enter the agreed-upon price.</p>
            <div className="mt-5 flex flex-wrap items-end gap-4">
              <div className="flex-1 min-w-[200px]">
                <label className="mb-1.5 block text-sm font-medium text-gray-300">Custom Monthly Price (USD)</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-400">$</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder={calc.margin90.toFixed(0)}
                    value={customPrice}
                    onChange={(e) => setCustomPrice(e.target.value)}
                    className="w-full rounded-lg border border-gray-600 bg-gray-700 py-3 pl-8 pr-4 text-lg font-bold text-white placeholder-gray-500 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30 focus:outline-none"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={handleCreate}
                disabled={!customPrice || parseFloat(customPrice) <= 0}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-violet-700 px-6 py-3.5 text-sm font-bold text-white shadow-lg transition-all hover:from-violet-700 hover:to-violet-800 hover:shadow-xl disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Create Enterprise Account <ArrowRight className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 rounded-lg bg-white/5 px-4 py-3">
              <p className="text-xs text-gray-400">
                <strong className="text-gray-300">Summary:</strong>{" "}
                {dashboards} client dashboards + 1 free agency, {keywords.toLocaleString()} keywords, {credits.toLocaleString()} credits/mo, {teamUsers} team users
                {customPrice && parseFloat(customPrice) > 0 && (
                  <> — <strong className="text-violet-400">{fmt(parseFloat(customPrice))}/mo</strong> ({((1 - calc.totalCost / parseFloat(customPrice)) * 100).toFixed(1)}% margin)</>
                )}
              </p>
            </div>
          </div>

          {/* Demo Link */}
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/50 p-5 text-center">
            <p className="text-sm text-gray-600">Need to schedule a demo with a prospect?</p>
            <a
              href={ENTERPRISE_DEMO_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-primary-600 hover:text-primary-700"
            >
              Open Booking Calendar <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EnterpriseCalculatorPage;
