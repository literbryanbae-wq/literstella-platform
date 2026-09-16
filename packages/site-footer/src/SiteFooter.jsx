import React from 'react';
import {footerHtml} from './footer.mjs';
import './footer.css';

export default function SiteFooter({app, onPrivacy, onTerms, onRefund, onPayment}) {
 const handlers={privacy:onPrivacy,terms:onTerms,refund:onRefund,payment:onPayment};
 const actions=Object.keys(handlers).filter(key=>typeof handlers[key]==='function');
 return <div onClick={event=>{
  const button=event.target.closest?.('[data-footer-action]');
  if(button&&event.currentTarget.contains(button))handlers[button.dataset.footerAction]?.();
 }} dangerouslySetInnerHTML={{__html:footerHtml({app,actions})}} />;
}
