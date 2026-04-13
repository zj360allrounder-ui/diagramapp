import { memo } from 'react';

function GroupNode({ data, selected }) {
  return (
    <div className={`group-node ${selected ? 'group-node--selected' : ''}`}>
      <div className="group-node__header">{data?.label ?? 'Region'}</div>
      <div className="group-node__body" aria-hidden />
    </div>
  );
}

export default memo(GroupNode);
