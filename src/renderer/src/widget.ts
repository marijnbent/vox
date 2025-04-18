import WidgetApp from './WidgetApp.svelte';
import { mount } from 'svelte';

import './assets/widget.css'

const app = mount(WidgetApp, { target: document.getElementById("widget-root") });
