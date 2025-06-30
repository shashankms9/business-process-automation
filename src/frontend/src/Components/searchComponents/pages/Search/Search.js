import React, { useEffect, useState } from 'react';
import axios from 'axios';
import CircularProgress from '@material-ui/core/CircularProgress';

import Results from '../../components/Results/Results';
import Pager from '../../components/Pager/Pager';
import Facets from '../../components/Facets/Facets';
import SearchBar from '../../components/SearchBar/SearchBar';

import "./Search.css";
//import { toolbarMenuItemBehavior } from '@fluentui/react-northstar';

export default function Search(props) {

  const [results, setResults] = useState([]);
  const [resultCount, setResultCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [q, setQ] = useState(""); // Use empty string for match-all
  const [top] = useState(10);
  const [skip, setSkip] = useState(0);
  const [filters, setFilters] = useState([]);
  const [facets, setFacets] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false)
  const [answers, setAnswers] = useState([])
  const [openAiAnswer, setOpenAiAnswer] = useState([])
  //const [openAiSummary, setOpenAiSummary] = useState("")

  let resultsPerPage = top;


  const getFacetSearchConfig = (_facets) => {
    const result = []
    for (const _facet of _facets) {
      if (_facet !== '') {
        result.push(`${_facet},count:1000`)
      }
    }
    return result
  }

  const getFacetsString = (facets) => {
    let result = ""
    let index = 0
    for (const facet of facets) {
      if (index === 0) {
        result = facet
      } else {
        result += `, ${facet}`
      }
      index++
    }
    return result
  }

  const getText = (searchables, data) => {
    try {
      if (!searchables || searchables.length === 0) {
        return ""
      }
      let out = ""

      for (const s of searchables) {
        if (!s.includes('vector')) {
          let currentData = data
          for (const i of s.split('/')) {
            if (Array.isArray(currentData[i])) {
              currentData = currentData[i][0]
            } else {
              currentData = currentData[i]
            }
          }
          out += currentData
        }
      }
      return out
    } catch (err) {
      console.log(err)
    }

  }

  const openaiQuestion = async (question, searchableText) => {
    const out = await axios.post(`/api/openaianswer`, {
      q: question,
      text: searchableText
    })
    return out.data.out
  }

  const isVectorSearch = (index) => { //look for vector field in index
    let isVector = false
    for (const s of index.searchableFields) {
      if (s.includes('vector')) {
        isVector = true;
        break;
      }
    }
    return isVector
  }

  const onSearchResponse = async (response) => {
    let results
    let count = 0
    if (response?.data?.results && response.data.results["@odata.count"]) {
      results = response.data.results.value
      count = response?.data?.results["@odata.count"]
      if (response?.data?.results["@search.facets"]) {
        setFacets(response.data.results["@search.facets"]);
      }
      if (response.data.results["@search.answers"]) {
        setAnswers(response.data.results["@search.answers"]);
      }
    } else if (response?.data?.results?.value) {
      results = response.data.results.value
      count = response.data.results.value.length
      setAnswers([])
      setFacets([])
    } else {
      results = []
      count = 0
      setAnswers([])
      setFacets([])
    }
    setResults(results)
    setResultCount(count)
    setIsLoading(false)
    setIsError(false)

    // Debug: Log results to help diagnose missing files
    console.log("Search API results:", results);

    if (skip === 0 && props.useOpenAiAnswer && results.length > 0 && q.length > 1) {

      let maxIterations = 10
      let openAiAnswers = []
      for (let i = 0; i < maxIterations; i++) {
        const prompt = `
        Answer the Question using the Context only.  If the context does not have any relevant information regarding the question, respond "NOT RELEVANT"
        Question : ${q}
        Context : ${getText(props.index.searchableFields, results[i])}
        Answer :`

        const answer = await openaiQuestion(q, prompt)
        if (answer.includes("NOT RELEVANT")) {
          break
        }
        openAiAnswers.push({
          filename : results[i].filename,
          content : answer
        })
        
      }
      if(openAiAnswers.length === 0){
        openAiAnswers = [{
          filename : "", content : "no response"
        }]
      } 
      setOpenAiAnswer(openAiAnswers)

    }
  }

  useEffect(() => {

    setIsLoading(true);
    // Compute skip locally to avoid stale state
    const localSkip = (currentPage - 1) * top;

    // Defensive: Only proceed if props.index is defined and has required fields
    if (!props.index || !props.index.searchableFields || !props.index.facetableFields) {
      setIsLoading(false);
      setResults([]);
      setResultCount(0);
      setFacets([]);
      setAnswers([]);
      return;
    }

    const body = {
      isVector: isVectorSearch(props.index),
      q: q,
      top: top,
      skip: localSkip,
      filters: filters,
      facets: getFacetSearchConfig(getFacetsString(props.index.facetableFields).split(',')),
      index: props.index,
      useSemanticSearch: props.useSemanticSearch,
      semanticConfig: props.semanticConfig,
      queryLanguage: "en-US",
      filterCollections: props.index.collections
    }

    setOpenAiAnswer([])
    axios.post('/api/search', body)
      .then(response => {
        onSearchResponse(response)
      })
      .catch(error => {
        console.log(error);
        setIsLoading(false);
      });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, top, currentPage, filters, props.index, props.useSemanticSearch, props.semanticConfig, props]);
  // Removed skip from dependency array


  // pushing the new search term to history when q is updated
  // allows the back button to work as expected when coming back from the details page
  useEffect(() => {
    //history.push('/search?q=' + q);  
    setCurrentPage(1);
    setFilters([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);


  let postSearchHandler = (searchTerm) => {
    // pushing the new search term to history when q is updated
    // allows the back button to work as expected when coming back from the details page
    //history.push('/search?q=' + searchTerm);  
    setCurrentPage(1);
    setSkip(0);
    setFilters([]);
    setQ(searchTerm);
  }

  let updatePagination = (newPageNumber) => {
    setCurrentPage(newPageNumber);
    setSkip((newPageNumber - 1) * top);
  }

  var body;
  if (isLoading) {
    body = (
      <div className="col-md-9">
        <CircularProgress />
      </div>);
  } else if (isError) {
    body = (
      <div className="col-md-9" style={{ margin: "100px" }}>
        Search Failed.  Make sure you have Semantic Search enabled.
      </div>);
  }
  else if (results.length === 0) {
    body = (
      <div className="col-md-9" style={{ margin: "100px" }}>
        No results found. Try a different search or check your index.
      </div>
    );
  }
  else {
    body = (
      <div className="col-md-9">
        <Results
          openAiAnswer={openAiAnswer}
          useTableSearch={props.useTableSearch}
          useOpenAiAnswer={props.useOpenAiAnswer}
          tableSearchConfig={props.tableSearchConfig}
          filterCollections={props.index.collections}
          answers={answers}
          facets={facets}
          searchables={props.index.searchableFields}
          documents={results}
          top={top}
          skip={skip}
          count={resultCount}
        />
        <Pager
          className="pager-style"
          currentPage={currentPage}
          resultCount={resultCount}
          resultsPerPage={resultsPerPage}
          setCurrentPage={updatePagination}
        />
      </div>
    )
  }
  return (
    <main className="main main--search container-fluid">
      <div className="row">
        <div className="col-md-3">
          <div className="search-bar">
            <SearchBar postSearchHandler={postSearchHandler} q={q}></SearchBar>
          </div>
          <Facets facets={facets} filters={filters} setFilters={setFilters}></Facets>
        </div>
        {body}
      </div>
    </main>
  );
}
