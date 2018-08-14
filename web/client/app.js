import React, {Component} from 'react';
import ReactDOM from 'react-dom';
import Main from './Main';

if (process.env.NODE_ENV === 'production'){
  if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__
      && Object.keys(window.__REACT_DEVTOOLS_GLOBAL_HOOK__._renderers).length ){
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__._renderers = {};
  }
}

class App extends Component {
  constructor(props) {
    super(props);
    this.state = {
      loading: true,
    };
  }
  render() { return <Main />}
}

ReactDOM.render(<App />, document.getElementById('main-content-wrapper'));
