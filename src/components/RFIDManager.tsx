"use client";
import { useState, useEffect } from "react";
import { useAPI, RFIDTag, RFIDData } from "@/lib/api-client";

export default function RFIDManager() {
  const [tags, setTags] = useState<RFIDTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [newScan, setNewScan] = useState<Partial<RFIDData>>({
    tag_id: "",
    customer_name: "",
    part_number: "",
    description: ""
  });
  
  const api = useAPI();

  useEffect(() => {
    loadTags();
  }, []);

  const loadTags = async () => {
    try {
      setLoading(true);
      const data = await api.getRFIDTags();
      setTags(data);
    } catch (err) {
      setError("Failed to load RFID tags");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleScanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newScan.tag_id || !newScan.customer_name || !newScan.part_number) {
      setError("Please fill in all required fields");
      return;
    }

    try {
      setLoading(true);
      setError("");
      
      await api.processRFIDScan(newScan as RFIDData);
      
      // Reset form
      setNewScan({
        tag_id: "",
        customer_name: "",
        part_number: "",
        description: ""
      });
      
      // Reload tags
      await loadTags();
      
    } catch (err) {
      setError("Failed to process RFID scan");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">RFID Tag Manager</h1>
      
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* New Scan Form */}
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Scan New RFID Tag</h2>
        <form onSubmit={handleScanSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Tag ID *
            </label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={newScan.tag_id}
              onChange={(e) => setNewScan({...newScan, tag_id: e.target.value})}
              required
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Customer Name *
            </label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={newScan.customer_name}
              onChange={(e) => setNewScan({...newScan, customer_name: e.target.value})}
              required
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Part Number *
            </label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={newScan.part_number}
              onChange={(e) => setNewScan({...newScan, part_number: e.target.value})}
              required
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Description
            </label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={newScan.description}
              onChange={(e) => setNewScan({...newScan, description: e.target.value})}
            />
          </div>
          
          <div className="md:col-span-2">
            <button
              type="submit"
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
              disabled={loading}
            >
              {loading ? "Processing..." : "Process Scan"}
            </button>
          </div>
        </form>
      </div>

      {/* Tags List */}
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">RFID Tags</h2>
          <button
            onClick={loadTags}
            className="bg-gray-600 text-white px-3 py-1 rounded hover:bg-gray-700"
            disabled={loading}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
        
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Tag ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Customer
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Part Number
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Description
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Last Scanned
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {tags.map((tag) => (
                <tr key={tag.tag_id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {tag.tag_id}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {tag.customer_name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {tag.part_number}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {tag.description}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(tag.last_scanned).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          {tags.length === 0 && !loading && (
            <div className="text-center py-8 text-gray-500">
              No RFID tags found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
