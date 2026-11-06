import { useMemo, useState } from 'react';

const pageSize = 5;

export function useMerchantDirectory(merchants) {
  const [search, setSearch] = useState('');
  const [rubro, setRubro] = useState('');
  const [zona, setZona] = useState('');
  const [page, setPage] = useState(1);

  const filteredMerchants = useMemo(() => {
    const query = search.trim().toLowerCase();
    return merchants.filter(([, name, category, document, merchantZone, , , , businessCode]) => {
      const matchesSearch = !query || [name, document, businessCode]
        .some((value) => String(value).toLowerCase().includes(query));
      const matchesRubro = !rubro || String(category).toLowerCase().includes(rubro.toLowerCase());
      const matchesZona = !zona || String(merchantZone).toLowerCase().includes(zona.toLowerCase());
      return matchesSearch && matchesRubro && matchesZona;
    });
  }, [merchants, search, rubro, zona]);

  const totalPages = Math.max(Math.ceil(filteredMerchants.length / pageSize), 1);
  const currentPage = Math.min(page, totalPages);
  const visibleMerchants = filteredMerchants.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const changeSearch = (value) => {
    setSearch(value);
    setPage(1);
  };
  const changeRubro = (value) => {
    setRubro(value);
    setPage(1);
  };
  const changeZona = (value) => {
    setZona(value);
    setPage(1);
  };
  const clearFilters = () => {
    setSearch('');
    setRubro('');
    setZona('');
    setPage(1);
  };

  return {
    search,
    rubro,
    zona,
    page: currentPage,
    pageSize,
    totalPages,
    filteredMerchants,
    visibleMerchants,
    changeSearch,
    changeRubro,
    changeZona,
    clearFilters,
    setPage
  };
}
