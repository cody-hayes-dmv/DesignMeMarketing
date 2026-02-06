import React from "react";
import { useLocation } from "react-router-dom";

const titles: Record<string, string> = {
  "/agency/managed-services": "Managed Services",
  "/agency/add-ons": "Add-Ons",
};

const PlaceholderAgencyPage = () => {
  const { pathname } = useLocation();
  const title = titles[pathname] ?? "Page";

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
      <p className="mt-2 text-gray-600">This page is under construction.</p>
    </div>
  );
};

export default PlaceholderAgencyPage;
