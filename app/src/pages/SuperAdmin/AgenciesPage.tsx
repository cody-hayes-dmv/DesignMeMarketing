import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/store";
import { fetchAgencies, inviteAgency } from "@/store/slices/agencySlice";
import Layout from "@/components/Layout";
import { Plus, Users, Building2, Mail } from "lucide-react";

const AgenciesPage = () => {
    const dispatch = useDispatch();
    const { agencies, loading } = useSelector((state: RootState) => state.agency);

    useEffect(() => {
        dispatch(fetchAgencies() as any);
    }, [dispatch]);

    return (
        <div className="p-8">
            {/* Header */}
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Agencies</h1>
                    <p className="text-gray-600 mt-2">
                        Manage your all agencies and view their details
                    </p>
                </div>
                <button
                    className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 transition-colors flex items-center space-x-2"
                >
                    <Plus className="h-5 w-5" />
                    <span>New Agency</span>
                </button>
            </div>

            {/* Agencies Table */}
            <div className="bg-white rounded-xl border border-gray-200">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Agency
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Subdomain
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Members
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Created
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {agencies.map((agency) => (
                                <tr key={agency.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="text-sm font-medium text-gray-900">
                                            {agency.name}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <a
                                            className="text-sm text-gray-600 underline"
                                            href={
                                                agency.subdomain
                                                    ? `https://${agency.subdomain}.yourseodashboard.com`
                                                    : "-"
                                            }
                                            target="_blank" rel="noopener noreferrer"
                                        >
                                            {agency.subdomain
                                                ? `${agency.subdomain}.yourseodashboard.com`
                                                : "-"}
                                        </a>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="text-sm text-gray-900">
                                            {agency.memberCount}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="text-sm text-gray-600">
                                            {new Date(agency.createdAt).toLocaleDateString()}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        <button className="text-primary-600 hover:text-primary-900">
                                            Manage
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}

export default AgenciesPage;