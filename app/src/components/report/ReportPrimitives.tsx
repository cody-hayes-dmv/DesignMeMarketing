import React from "react";

export const ReportSection: React.FC<{
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}> = ({ title, subtitle, children, className = "" }) => {
  return (
    <section className={`bg-white rounded-xl border border-gray-200 ${className}`}>
      <div className="p-6 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        {subtitle ? <p className="text-sm text-gray-500 mt-1">{subtitle}</p> : null}
      </div>
      <div className="p-6">{children}</div>
    </section>
  );
};

export const ReportEmptyState: React.FC<{ message: string }> = ({ message }) => (
  <div className="rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-600 bg-gray-50">
    {message}
  </div>
);
